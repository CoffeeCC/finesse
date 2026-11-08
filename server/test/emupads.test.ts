// The first controller in each emulator: the virtual pads' identities, each
// emulator's generated mapping, and the launch script's shell that writes it
// (run here with bash against a scratch home): written on a fresh home, over the
// emulator's exact first-start default, or over Finesse's own earlier write (its
// stamp, or its mapping for either virtual pad); a player's own mapping, keyboard
// or controller, is left alone; and it's idempotent.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { emulatorCatalog, launchScript } from '../src/emulators.ts'
import { CEMU_SETTINGS, cemuController, controllerShell, DOLPHIN_GC_FACTORY, DOLPHIN_SETTINGS, DOLPHIN_WII_FACTORY, PCSX2_KEYBOARD, RPCS3_KEYBOARD, RYUJINX_KEYBOARD, stampFile, dolphinGCPad, dolphinWiimote, edenControls, edenGuid, INI_HELPERS, padFor, rpcs3Input, ryujinxId, ryujinxInput, SELKIES_PAD, WOLF_PAD, type ControllerId, type VirtualPad } from '../src/emupads.ts'
import { tmp } from './helpers.ts'

/** SDL's CRC-16 of a name (the GUID's bytes 2-3, little-endian). */
function crc16(s: string) {
  let c = 0
  for (const b of Buffer.from(s)) {
    c ^= b
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1
  }
  return c
}

/** Runs one emulator's mapping shell in a scratch home. */
function map(id: ControllerId, home: string, pad: VirtualPad) {
  execFileSync('bash', ['-e', '-c', [...INI_HELPERS, controllerShell(id, home, pad)].join('\n')], { stdio: 'pipe' })
}
const read = (f: string) => readFileSync(f, 'utf8')

describe('the virtual pads', () => {
  test('identities are SDL’s: the name’s CRC in bytes 2-3; Selkies’ pad is name-based, Wolf’s carries its USB ids', () => {
    for (const p of [SELKIES_PAD, WOLF_PAD]) assert.equal(p.guid.slice(4, 8), Buffer.from([crc16(p.name) & 0xff, crc16(p.name) >> 8]).toString('hex'), p.name)
    // Through Selkies' stand-in udev SDL reads vendor and product as 0, so the GUID holds the name.
    assert.equal(Buffer.from(SELKIES_PAD.guid.slice(8), 'hex').toString('latin1').replace(/\0+$/, ''), 'Microsoft X')
    // Wolf's: USB bus 3, 045e:02ea, version 0x0408.
    assert.equal(WOLF_PAD.guid, `0300${WOLF_PAD.guid.slice(4, 8)}5e040000ea02000008040000`)
    assert.equal(edenGuid(SELKIES_PAD), '000000004d6963726f736f6674205800')
    assert.equal(edenGuid(WOLF_PAD), '030000005e040000ea02000008040000')
    assert.equal(padFor(true), SELKIES_PAD)
    assert.equal(padFor(false), WOLF_PAD)
  })

  test('browser play keeps Selkies’ LD_PRELOAD in sharun AppImages; Moonlight’s real pads need nothing', () => {
    const cat = emulatorCatalog('eden', '/config')
    const browser = launchScript(cat.switch, Object.values(cat), { home: '/config', browser: true })
    assert.match(browser, /^export SHARUN_ALLOW_LD_PRELOAD=1 SDL_JOYSTICK_DISABLE_UDEV=1$/m)
    assert.ok(browser.indexOf('SHARUN_ALLOW_LD_PRELOAD') < browser.indexOf('launcher /tmp/finesse-run.sh'))
    assert.match(browser, /guid:000000004d6963726f736f6674205800/)
    const wolf = launchScript(emulatorCatalog('eden').switch, Object.values(emulatorCatalog('eden')))
    assert.doesNotMatch(wolf, /SHARUN_ALLOW_LD_PRELOAD|SDL_JOYSTICK_DISABLE_UDEV/)
    assert.match(wolf, /guid:030000005e040000ea02000008040000/)
  })

  test('every emulator maps the first pad, and ES-DE maps them all', () => {
    const cat = emulatorCatalog('eden')
    for (const id of ['pcsx2', 'dolphin', 'rpcs3', 'cemu', 'switch'] as const) assert.ok(cat[id].controller, id)
    assert.equal(emulatorCatalog('ryujinx').switch.controller, 'ryujinx')
    const esde = launchScript(cat.esde, Object.values(cat))
    for (const f of ['PCSX2.ini', 'GCPadNew.ini', 'Default.yml', 'controller0.xml', 'qt-config.ini']) assert.ok(esde.includes(f), f)
  })
})

describe('generated mappings', () => {
  test('Eden: position-based Pro Controller on raw SDL indexes, GUID without its CRC', () => {
    const kv = Object.fromEntries(edenControls(SELKIES_PAD))
    const g = 'guid:000000004d6963726f736f6674205800'
    assert.equal(kv.player_0_button_a, `"engine:sdl,port:0,${g},button:1"`, 'A is the east button')
    assert.equal(kv.player_0_button_b, `"engine:sdl,port:0,${g},button:0"`)
    assert.equal(kv.player_0_button_x, `"engine:sdl,port:0,${g},button:3"`, 'X is the north button')
    assert.equal(kv.player_0_button_y, `"engine:sdl,port:0,${g},button:2"`)
    assert.equal(kv.player_0_button_zr, `"engine:sdl,port:0,${g},axis:5,threshold:0.500000,invert:+"`)
    assert.equal(kv.player_0_button_dup, `"engine:sdl,port:0,${g},hat:0,direction:up"`)
    assert.match(kv.player_0_rstick!, /axis_x:3,.*axis_y:4,/)
    assert.equal(kv.player_0_type, '0')
    assert.equal(kv['player_0_button_a\\default'], 'false', 'QSettings’ "set by someone" flag')
  })

  test('Ryujinx: SDL2 gamepad id as .NET writes the GUID, CRC zeroed; position-based face buttons', () => {
    assert.equal(ryujinxId(WOLF_PAD), '0-00000003-045e-0000-ea02-000008040000')
    assert.equal(ryujinxId(SELKIES_PAD), '0-00000000-694d-7263-6f73-6f6674205800')
    const r = ryujinxInput(WOLF_PAD)
    assert.deepEqual([r.right_joycon.button_a, r.right_joycon.button_b, r.right_joycon.button_x, r.right_joycon.button_y], ['B', 'A', 'Y', 'X'])
    assert.equal(r.backend, 'GamepadSDL2')
    assert.equal(r.player_index, 'Player1')
  })

  test('Dolphin: GameCube pad and Wii Remote + Nunchuk on SDL/0/<gamepad name>, Dolphin’s input names', () => {
    const gc = Object.fromEntries(dolphinGCPad(WOLF_PAD))
    assert.equal(gc.Device, 'SDL/0/Xbox One S Controller')
    assert.equal(gc['Buttons/A'], '`Button S`')
    assert.equal(gc['Buttons/B'], '`Button W`')
    assert.equal(gc['Main Stick/Up'], '`Left Y+`', 'Dolphin’s Y+ is up')
    assert.equal(gc['Triggers/R-Analog'], '`Trigger R`')
    const wii = Object.fromEntries(dolphinWiimote(SELKIES_PAD))
    assert.equal(wii.Device, 'SDL/0/Microsoft X-Box 360 pad')
    assert.equal(wii.Source, '1')
    assert.equal(wii.Extension, 'Nunchuk')
    assert.equal(wii['Buttons/B'], '`Trigger R`')
    assert.equal(wii['Nunchuk/Stick/Down'], '`Left Y-`')
    const s = Object.fromEntries(DOLPHIN_SETTINGS.flatMap((x) => x.kv.map(([k, v]) => [`${x.section}/${k}`, v])))
    assert.equal(s['Display/Fullscreen'], 'True')
    assert.equal(s['Interface/SkipNKitWarning'], 'True')
    assert.equal(s['Input/BackgroundInput'], 'True')
  })

  test('RPCS3: Player 1 on SDL’s "<name> 1"; RPCS3 fills in its SDL defaults', () => {
    assert.equal(rpcs3Input(SELKIES_PAD), 'Player 1 Input:\n  Handler: SDL\n  Device: Microsoft X-Box 360 pad 1\n')
    assert.match(rpcs3Input(WOLF_PAD), /Device: Xbox One S Controller 1/)
  })

  test('Cemu: a Wii U GamePad on "0_<GUID>", position-based', () => {
    const x = cemuController(WOLF_PAD)
    assert.match(x, /<api>SDLController<\/api>/)
    assert.match(x, /<uuid>0_030015655e040000ea02000008040000<\/uuid>/)
    const m = Object.fromEntries([...x.matchAll(/<mapping>(\d+)<\/mapping><button>(\d+)<\/button>/g)].map((r) => [r[1], Number(r[2])]))
    assert.equal(m['1'], 1, 'A on the east button')
    assert.equal(m['2'], 0, 'B on the south button')
    assert.equal(m['7'], 42, 'ZL on the left trigger')
    assert.equal(m['17'], 45, 'left stick up is the negative Y axis')
    assert.equal(Object.keys(m).length, 25)
  })
})

describe('the mapping shell', () => {
  test('Eden: written fresh, over Eden’s default, and over its own earlier write; a player’s own (keyboard too) kept', () => {
    const H = tmp('emupad-eden-')
    const f = join(H, '.config/eden/qt-config.ini')
    map('eden', H, SELKIES_PAD)
    assert.match(read(f), /^\[Controls\]$/m)
    assert.match(read(f), /^player_0_button_a="engine:sdl,port:0,guid:000000004d6963726f736f6674205800,button:1"$/m)
    assert.match(read(f), /^confirmStop=2$/m)
    assert.ok(existsSync(stampFile(H, 'eden')), 'Finesse remembers what it wrote')
    const once = read(f)
    map('eden', H, SELKIES_PAD)
    assert.equal(read(f), once, 'nothing changes the second time')
    // Eden's own first-start default: every key at its default (QSettings' "\default=true"), other sections around.
    writeFileSync(f, '[UI]\nconfirmStop\\default=true\nconfirmStop=0\n\n[Controls]\nplayer_0_button_a\\default=true\nplayer_0_button_a="engine:keyboard,code:67,toggle:0"\nplayer_0_button_b\\default=true\nplayer_0_button_b="engine:keyboard,code:88,toggle:0"\nplayer_1_button_a="engine:keyboard,code:67,toggle:0"\n\n[Renderer]\nbackend=1\n')
    rmSync(stampFile(H, 'eden'))
    map('eden', H, WOLF_PAD)
    const t = read(f)
    assert.equal(t.match(/^player_0_button_a=/gm)?.length, 1)
    assert.match(t, /^player_0_button_a="engine:sdl,port:0,guid:030000005e040000ea02000008040000,button:1"$/m)
    assert.match(t, /^player_1_button_a="engine:keyboard,code:67,toggle:0"$/m, 'other players untouched')
    assert.match(t, /\[Renderer\]\nbackend=1/)
    assert.match(t, /^confirmStop=2$/m)
    // Finesse's mapping for the other virtual pad (a Moonlight home that once had browser play's) is Finesse's.
    map('eden', H, SELKIES_PAD)
    assert.match(read(f), /guid:000000004d6963726f736f6674205800,button:1/)
    // An older Finesse's write (its stamp matches, the mapping isn't today's): updated.
    writeFileSync(f, read(f).replace(/button:1"$/m, 'button:4"'))
    execFileSync('bash', ['-e', '-c', [...INI_HELPERS, controllerShell('eden', H, SELKIES_PAD, { stampOnly: true })].join('\n')])
    map('eden', H, SELKIES_PAD)
    assert.match(read(f), /^player_0_button_a="engine:sdl,port:0,guid:000000004d6963726f736f6674205800,button:1"$/m)
    // A player's own keyboard mapping (a key they changed: "\default=false") stays.
    const kb = '[Controls]\nplayer_0_button_a\\default=false\nplayer_0_button_a="engine:keyboard,code:74,toggle:0"\n'
    writeFileSync(f, kb)
    map('eden', H, SELKIES_PAD)
    assert.match(read(f), /code:74/)
    assert.doesNotMatch(read(f), /engine:sdl/)
    // Their own controller, and their choice of stopping, stay too.
    writeFileSync(f, '[UI]\nconfirmStop\\default=false\nconfirmStop=0\ncheck_for_updates\\default=false\ncheck_for_updates=true\n[Controls]\nplayer_0_button_a\\default=false\nplayer_0_button_a="engine:sdl,port:0,guid:0300aaaa,button:4"\n')
    const mine = read(f)
    map('eden', H, SELKIES_PAD)
    assert.equal(read(f), mine)
  })

  test('Dolphin: pads written fresh or over Dolphin’s keyboard default; a player’s own (keyboard too) kept; settings only where unset', () => {
    const H = tmp('emupad-dolphin-')
    const d = join(H, '.config/dolphin-emu')
    map('dolphin', H, SELKIES_PAD)
    assert.match(read(join(d, 'GCPadNew.ini')), /^\[GCPad1\]\nDevice = SDL\/0\/Microsoft X-Box 360 pad\nButtons\/A = `Button S`$/m)
    assert.match(read(join(d, 'WiimoteNew.ini')), /^Extension = Nunchuk$/m)
    assert.match(read(join(d, 'Dolphin.ini')), /^Fullscreen = True$/m)
    assert.match(read(join(d, 'Dolphin.ini')), /^GFXBackend = (OGL|Vulkan)$/m)
    const once = read(join(d, 'Dolphin.ini')) + read(join(d, 'GCPadNew.ini'))
    map('dolphin', H, SELKIES_PAD)
    assert.equal(read(join(d, 'Dolphin.ini')) + read(join(d, 'GCPadNew.ini')), once)
    // The player's choices stay: their renderer, and a pad on a real controller.
    writeFileSync(join(d, 'Dolphin.ini'), '[Display]\nFullscreen = False\n[Core]\nGFXBackend = Software Renderer\n')
    writeFileSync(join(d, 'GCPadNew.ini'), '[GCPad1]\nDevice = SDL/0/DualSense Wireless Controller\nButtons/A = `Button E`\n')
    map('dolphin', H, SELKIES_PAD)
    assert.match(read(join(d, 'Dolphin.ini')), /^Fullscreen = False$/m)
    assert.match(read(join(d, 'Dolphin.ini')), /^GFXBackend = Software Renderer$/m)
    assert.match(read(join(d, 'Dolphin.ini')), /^SkipNKitWarning = True$/m)
    assert.match(read(join(d, 'GCPadNew.ini')), /DualSense/)
    // Dolphin's own keyboard default (as Dolphin writes it: its keys, plus settings Finesse doesn't touch) is replaced.
    const factory = (defaults: Record<string, string[]>, section: string) =>
      `[${section}]\n${Object.entries(defaults).filter(([, v]) => v.some((x) => x && !x.startsWith('~'))).map(([k, v]) => `${k} = ${v.find((x) => x && !x.startsWith('~'))}`).join('\n')}\nDevice = XInput2/0/Virtual core pointer\nMain Stick/Calibration = 100.00 100.00 100.00 100.00\n`
    writeFileSync(join(d, 'GCPadNew.ini'), factory(DOLPHIN_GC_FACTORY, 'GCPad1'))
    writeFileSync(join(d, 'WiimoteNew.ini'), factory(DOLPHIN_WII_FACTORY, 'Wiimote1'))
    map('dolphin', H, WOLF_PAD)
    assert.match(read(join(d, 'GCPadNew.ini')), /^Device = SDL\/0\/Xbox One S Controller$/m)
    assert.match(read(join(d, 'GCPadNew.ini')), /^Buttons\/A = `Button S`$/m)
    assert.equal(read(join(d, 'GCPadNew.ini')).match(/^Buttons\/A/gm)?.length, 1)
    assert.match(read(join(d, 'GCPadNew.ini')), /^Main Stick\/Calibration = 100/m, 'what Finesse doesn’t map stays')
    assert.match(read(join(d, 'WiimoteNew.ini')), /^Device = SDL\/0\/Xbox One S Controller$/m)
    // An older Finesse's write, by its stamp: updated.
    writeFileSync(join(d, 'GCPadNew.ini'), read(join(d, 'GCPadNew.ini')).replace('Buttons/A = `Button S`', 'Buttons/A = `Button E`'))
    execFileSync('bash', ['-e', '-c', [...INI_HELPERS, controllerShell('dolphin', H, WOLF_PAD, { stampOnly: true })].join('\n')])
    map('dolphin', H, WOLF_PAD)
    assert.match(read(join(d, 'GCPadNew.ini')), /^Buttons\/A = `Button S`$/m)
    // A player's own keyboard mapping (one key changed from Dolphin's default) stays.
    const custom = factory(DOLPHIN_GC_FACTORY, 'GCPad1').replace('Buttons/A = `X`', 'Buttons/A = `Space`')
    writeFileSync(join(d, 'GCPadNew.ini'), custom)
    map('dolphin', H, WOLF_PAD)
    assert.equal(read(join(d, 'GCPadNew.ini')), custom)
  })

  test('RPCS3: Player 1 replaced fresh or on RPCS3’s keyboard default, other players kept; a player’s own (keyboard too) kept', () => {
    const H = tmp('emupad-rpcs3-')
    const f = join(H, '.config/rpcs3/input_configs/global/Default.yml')
    map('rpcs3', H, WOLF_PAD)
    assert.equal(read(f), rpcs3Input(WOLF_PAD))
    map('rpcs3', H, WOLF_PAD)
    assert.equal(read(f), rpcs3Input(WOLF_PAD), 'idempotent')
    // RPCS3's own first-start Player 1: the keyboard with its default keys (and settings around them).
    const kb = (over: Record<string, string> = {}) =>
      `Player 1 Input:\n  Handler: Keyboard\n  Device: Keyboard\n  Config:\n${Object.entries(RPCS3_KEYBOARD).filter(([k]) => k !== 'Handler' && k !== 'Device').map(([k, v]) => `    ${k}: ${over[k] ?? v[0]}`).join('\n')}\n    Left Stick Multiplier: 100\n  Buddy Device: "Null"\nPlayer 2 Input:\n  Handler: "Null"\n  Device: "Null"\n`
    writeFileSync(f, kb())
    rmSync(stampFile(H, 'rpcs3'))
    map('rpcs3', H, SELKIES_PAD)
    assert.equal(read(f), `${rpcs3Input(SELKIES_PAD)}Player 2 Input:\n  Handler: "Null"\n  Device: "Null"\n`)
    // RPCS3 fills in its SDL defaults after Finesse's write: still a pad, nothing to do.
    // An older Finesse's write, by its stamp: updated.
    writeFileSync(f, 'Player 1 Input:\n  Handler: SDL\n  Device: Some Old Name 1\n')
    execFileSync('bash', ['-e', '-c', [...INI_HELPERS, controllerShell('rpcs3', H, SELKIES_PAD, { stampOnly: true })].join('\n')])
    map('rpcs3', H, SELKIES_PAD)
    assert.equal(read(f), rpcs3Input(SELKIES_PAD))
    // A player's own keyboard keys, or their own controller, stay.
    const mine = kb({ Cross: 'Space' })
    writeFileSync(f, mine)
    map('rpcs3', H, SELKIES_PAD)
    assert.equal(read(f), mine)
    writeFileSync(f, 'Player 1 Input:\n  Handler: DualSense\n  Device: DualSense Pad #1\n')
    map('rpcs3', H, SELKIES_PAD)
    assert.match(read(f), /DualSense Pad #1/)
  })

  test('Cemu: written when there’s no profile, and over its own earlier write; any profile of the player’s (keyboard too) kept', () => {
    const H = tmp('emupad-cemu-')
    const c = join(H, '.config/Cemu/controllerProfiles/controller0.xml')
    map('cemu', H, SELKIES_PAD)
    assert.equal(read(c), cemuController(SELKIES_PAD))
    assert.equal(read(join(H, '.config/Cemu/settings.xml')), CEMU_SETTINGS, 'no first-start assistant')
    writeFileSync(join(H, '.config/Cemu/settings.xml'), '<content><fullscreen>false</fullscreen></content>')
    map('cemu', H, SELKIES_PAD)
    assert.match(read(join(H, '.config/Cemu/settings.xml')), /false/, 'Cemu’s own settings are kept')
    map('cemu', H, WOLF_PAD)
    assert.equal(read(c), cemuController(WOLF_PAD), 'Finesse’s profile for the other virtual pad is Finesse’s')
    // An older Finesse's write, by its stamp: updated.
    writeFileSync(c, cemuController(WOLF_PAD).replace('<rumble>0</rumble>', '<rumble>1</rumble>'))
    execFileSync('bash', ['-e', '-c', [...INI_HELPERS, controllerShell('cemu', H, WOLF_PAD, { stampOnly: true })].join('\n')])
    map('cemu', H, WOLF_PAD)
    assert.equal(read(c), cemuController(WOLF_PAD))
    // Cemu writes no profile of its own: one on the keyboard is the player's.
    for (const own of [
      '<emulated_controller><type>Wii U GamePad</type><controller><api>Keyboard</api><uuid>keyboard</uuid></controller></emulated_controller>',
      '<emulated_controller><type>Wii U GamePad</type><controller><api>SDLController</api><uuid>0_0300aaaa</uuid></controller></emulated_controller>',
    ]) {
      writeFileSync(c, own)
      map('cemu', H, SELKIES_PAD)
      assert.equal(read(c), own)
    }
  })

  test('PCSX2: written fresh, over PCSX2’s keyboard default, or its own earlier write; a player’s keys or pad type kept', () => {
    const P = tmp('emupad-pcsx2-')
    const ini = join(P, '.config/PCSX2/inis/PCSX2.ini')
    mkdirSync(join(ini, '..'), { recursive: true })
    // PCSX2's own first-start Pad1: a DualShock 2 on the keyboard, with its other settings.
    const kb = (over: Record<string, string> = {}) =>
      `[UI]\nSetupWizardIncomplete = false\n\n[Pad1]\n${Object.entries({ ...PCSX2_KEYBOARD, ...over }).map(([k, v]) => `${k} = ${v}`).join('\n')}\nDeadzone = 0\n\n[Pad2]\nType = None\n`
    writeFileSync(ini, kb())
    map('pcsx2', P, SELKIES_PAD)
    const t = read(ini)
    assert.match(t, /^Cross = SDL-0\/FaceSouth$/m)
    assert.doesNotMatch(t, /Keyboard\/K/)
    assert.equal(t.match(/^Cross = /gm)?.length, 1)
    assert.match(t, /^Deadzone = 0$/m, 'PCSX2’s other pad settings stay')
    assert.match(t, /\[Pad2\]\nType = None/)
    assert.match(t, /SetupWizardIncomplete = false/)
    assert.match(t, /^SettingsVersion = 1$/m)
    map('pcsx2', P, SELKIES_PAD)
    assert.equal(read(ini), t, 'idempotent')
    // An older Finesse's mapping (A/B/X/Y names, before PCSX2 2.x): still Finesse's.
    writeFileSync(ini, t.replace('SDL-0/FaceSouth', 'SDL-0/A').replace('SDL-0/FaceEast', 'SDL-0/B').replace('SDL-0/FaceWest', 'SDL-0/X').replace('SDL-0/FaceNorth', 'SDL-0/Y'))
    rmSync(stampFile(P, 'pcsx2'))
    map('pcsx2', P, SELKIES_PAD)
    assert.match(read(ini), /^Cross = SDL-0\/FaceSouth$/m)
    // An older Finesse's write, by its stamp: updated.
    writeFileSync(ini, read(ini).replace('R3 = SDL-0/RightStick', 'R3 = SDL-0/Guide'))
    execFileSync('bash', ['-e', '-c', [...INI_HELPERS, controllerShell('pcsx2', P, SELKIES_PAD, { stampOnly: true })].join('\n')])
    map('pcsx2', P, SELKIES_PAD)
    assert.match(read(ini), /^R3 = SDL-0\/RightStick$/m)
    // A player's own keyboard keys, and a pad type they chose, stay.
    for (const own of [kb({ Cross: 'Keyboard/Space' }), '[Pad1]\nType = Guitar\nGreen = SDL-0/FaceSouth\n']) {
      writeFileSync(ini, own)
      map('pcsx2', P, SELKIES_PAD)
      const after = read(ini)
      assert.ok(after.includes(own.includes('Guitar') ? 'Type = Guitar\nGreen = SDL-0/FaceSouth' : 'Cross = Keyboard/Space'), after)
      assert.doesNotMatch(after, /FaceEast/)
    }
    // A fresh home: the settings version (or PCSX2 offers to reset everything), no wizard, a BIOS by name.
    const F = tmp('emupad-pcsx2-fresh-')
    mkdirSync(join(F, '.config/PCSX2/bios'), { recursive: true })
    for (const b of ['PS2 Bios 30004R V6 Pal.bin', 'rom1.bin', 'scph39001.bin', 'scph39001.NVM']) writeFileSync(join(F, '.config/PCSX2/bios', b), '')
    map('pcsx2', F, WOLF_PAD)
    const fresh = read(join(F, '.config/PCSX2/inis/PCSX2.ini'))
    assert.match(fresh, /^\[UI\]\nSettingsVersion = 1\nSetupWizardIncomplete = false\nConfirmShutdown = false$/m)
    assert.match(fresh, /^BIOS = scph39001\.bin$/m)
    assert.match(fresh, /^Cross = SDL-0\/FaceSouth$/m)
  })

  test('Ryujinx: Player 1 moves off Ryujinx’s keyboard default, or Finesse’s earlier write; a player’s own (keyboard too) kept', (t) => {
    try {
      execFileSync('python3', ['-c', '1'])
    } catch {
      return t.skip('no python3 here')
    }
    const H = tmp('emupad-ryu-')
    const f = join(H, '.config/Ryujinx/Config.json')
    map('ryujinx', H, WOLF_PAD)
    assert.ok(!existsSync(f), 'Ryujinx writes its own first')
    mkdirSync(join(f, '..'), { recursive: true })
    const kb = { ...RYUJINX_KEYBOARD, version: 1, player_index: 'Player1' }
    writeFileSync(f, JSON.stringify({ version: 70, enable_vsync: true, input_config: [kb, { ...kb, player_index: 'Player2' }] }))
    map('ryujinx', H, WOLF_PAD)
    const c = JSON.parse(read(f))
    assert.equal(c.version, 70)
    assert.equal(c.enable_vsync, true)
    assert.equal(c.input_config[0].id, '0-00000003-045e-0000-ea02-000008040000')
    assert.equal(c.input_config[1].player_index, 'Player2')
    // An older Finesse's write (stamp matches): updated.
    c.input_config[0].trigger_threshold = 0.2
    const old = c.input_config[0]
    writeFileSync(f, JSON.stringify(c))
    writeFileSync(stampFile(H, 'ryujinx'), execFileSync('python3', ['-c', 'import json,sys,hashlib; print(hashlib.sha256(json.dumps(json.loads(sys.argv[1]),sort_keys=True).encode()).hexdigest())', JSON.stringify(old)]).toString().trim())
    map('ryujinx', H, WOLF_PAD)
    assert.equal(JSON.parse(read(f)).input_config[0].trigger_threshold, 0.5)
    // Finesse's mapping for the other virtual pad: Finesse's.
    map('ryujinx', H, SELKIES_PAD)
    assert.equal(JSON.parse(read(f)).input_config[0].id, ryujinxId(SELKIES_PAD))
    // A player's own: another pad, or keyboard keys they changed.
    for (const own of [{ ...JSON.parse(read(f)).input_config[0], id: '0-something-else' }, { ...kb, right_joycon: { ...kb.right_joycon, button_a: 'Space' } }]) {
      writeFileSync(f, JSON.stringify({ input_config: [own] }))
      map('ryujinx', H, SELKIES_PAD)
      assert.deepEqual(JSON.parse(read(f)).input_config[0], own)
    }
  })
})
