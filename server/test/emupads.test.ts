// The first controller in each emulator: the virtual pads' identities, each
// emulator's generated mapping, and the launch script's shell that writes it
// (run here with bash against a scratch home): written on a fresh home or over
// the emulator's keyboard default, swapped when the other virtual pad's mapping
// is there, left alone when the player mapped their own, and idempotent.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { emulatorCatalog, launchScript } from '../src/emulators.ts'
import { cemuController, controllerShell, DOLPHIN_SETTINGS, dolphinGCPad, dolphinWiimote, edenControls, edenGuid, INI_HELPERS, padFor, rpcs3Input, ryujinxId, ryujinxInput, SELKIES_PAD, WOLF_PAD, type ControllerId, type VirtualPad } from '../src/emupads.ts'
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
  test('Eden: written over the keyboard default, swapped from the other pad, a player’s own kept, idempotent', () => {
    const H = tmp('emupad-eden-')
    const f = join(H, '.config/eden/qt-config.ini')
    map('eden', H, SELKIES_PAD)
    assert.match(read(f), /^\[Controls\]$/m)
    assert.match(read(f), /^player_0_button_a="engine:sdl,port:0,guid:000000004d6963726f736f6674205800,button:1"$/m)
    assert.match(read(f), /^confirmStop=2$/m)
    const once = read(f)
    map('eden', H, SELKIES_PAD)
    assert.equal(read(f), once, 'nothing changes the second time')
    // Eden's own keyboard default, with other sections around.
    writeFileSync(f, '[UI]\nconfirmStop\\default=true\nconfirmStop=0\n\n[Controls]\nplayer_0_button_a\\default=false\nplayer_0_button_a="engine:keyboard,code:67,toggle:0"\nplayer_1_button_a="engine:keyboard,code:67,toggle:0"\n\n[Renderer]\nbackend=1\n')
    map('eden', H, WOLF_PAD)
    const t = read(f)
    assert.equal(t.match(/^player_0_button_a=/gm)?.length, 1)
    assert.match(t, /^player_0_button_a="engine:sdl,port:0,guid:030000005e040000ea02000008040000,button:1"$/m)
    assert.match(t, /^player_1_button_a="engine:keyboard,code:67,toggle:0"$/m, 'other players untouched')
    assert.match(t, /\[Renderer\]\nbackend=1/)
    assert.match(t, /^confirmStop=2$/m)
    // The Selkies mapping in a Moonlight home (or the early hand-made guess) is ours to replace.
    writeFileSync(f, '[Controls]\nplayer_0_button_a="engine:sdl,port:0,guid:030000005e0400008e02000014010000,button:1"\n')
    map('eden', H, SELKIES_PAD)
    assert.match(read(f), /guid:000000004d6963726f736f6674205800,button:1/)
    // A player's own mapping (another controller, their choice of stopping) stays.
    writeFileSync(f, '[UI]\nconfirmStop\\default=false\nconfirmStop=0\ncheck_for_updates\\default=false\ncheck_for_updates=true\n[Controls]\nplayer_0_button_a="engine:sdl,port:0,guid:0300aaaa,button:4"\n')
    const mine = read(f)
    map('eden', H, SELKIES_PAD)
    assert.equal(read(f), mine)
  })

  test('Dolphin: pads written once, settings only where unset, a player’s own device kept', () => {
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
    // Dolphin's keyboard default (XInput2) and the other virtual pad are replaced.
    writeFileSync(join(d, 'GCPadNew.ini'), '[GCPad1]\nDevice = XInput2/0/Virtual core pointer\nButtons/A = `X`\n')
    map('dolphin', H, WOLF_PAD)
    assert.match(read(join(d, 'GCPadNew.ini')), /^Device = SDL\/0\/Xbox One S Controller\nButtons\/A = `Button S`$/m)
    assert.equal(read(join(d, 'GCPadNew.ini')).match(/^Buttons\/A/gm)?.length, 1)
  })

  test('RPCS3: Player 1 block replaced on the keyboard, other players kept; a player’s own handler kept', () => {
    const H = tmp('emupad-rpcs3-')
    const f = join(H, '.config/rpcs3/input_configs/global/Default.yml')
    map('rpcs3', H, WOLF_PAD)
    assert.equal(read(f), rpcs3Input(WOLF_PAD))
    map('rpcs3', H, WOLF_PAD)
    assert.equal(read(f), rpcs3Input(WOLF_PAD), 'idempotent')
    writeFileSync(f, 'Player 1 Input:\n  Handler: Keyboard\n  Device: Keyboard\n  Config:\n    Cross: X\nPlayer 2 Input:\n  Handler: "Null"\n  Device: "Null"\n')
    map('rpcs3', H, SELKIES_PAD)
    assert.equal(read(f), `${rpcs3Input(SELKIES_PAD)}Player 2 Input:\n  Handler: "Null"\n  Device: "Null"\n`)
    writeFileSync(f, 'Player 1 Input:\n  Handler: DualSense\n  Device: DualSense Pad #1\n')
    map('rpcs3', H, SELKIES_PAD)
    assert.match(read(f), /DualSense Pad #1/)
  })

  test('Cemu and PCSX2: written when missing or on the keyboard, kept otherwise', () => {
    const H = tmp('emupad-cemu-')
    const c = join(H, '.config/Cemu/controllerProfiles/controller0.xml')
    map('cemu', H, SELKIES_PAD)
    assert.equal(read(c), cemuController(SELKIES_PAD))
    writeFileSync(c, '<emulated_controller><type>Wii U GamePad</type><controller><api>Keyboard</api><uuid>keyboard</uuid></controller></emulated_controller>')
    map('cemu', H, WOLF_PAD)
    assert.equal(read(c), cemuController(WOLF_PAD))
    map('cemu', H, SELKIES_PAD)
    assert.equal(read(c), cemuController(SELKIES_PAD), 'the other virtual pad’s profile is ours to swap')
    const own = '<emulated_controller><type>Wii U GamePad</type><controller><api>SDLController</api><uuid>0_0300aaaa</uuid></controller></emulated_controller>'
    writeFileSync(c, own)
    map('cemu', H, SELKIES_PAD)
    assert.equal(read(c), own)

    const P = tmp('emupad-pcsx2-')
    const ini = join(P, '.config/PCSX2/inis/PCSX2.ini')
    mkdirSync(join(ini, '..'), { recursive: true })
    writeFileSync(ini, '[UI]\nSetupWizardIncomplete = false\n\n[Pad1]\nType = DualShock2\nCross = Keyboard/X\n\n[Pad2]\nType = None\n')
    map('pcsx2', P, SELKIES_PAD)
    const t = read(ini)
    assert.match(t, /^Cross = SDL-0\/FaceSouth$/m)
    assert.doesNotMatch(t, /Keyboard\/X/)
    assert.match(t, /\[Pad2\]\nType = None/)
    assert.match(t, /SetupWizardIncomplete = false/)
    map('pcsx2', P, SELKIES_PAD)
    assert.equal(read(ini), t, 'idempotent')
  })

  test('Ryujinx: Player 1 moves off the keyboard in its Config.json, the rest kept', (t) => {
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
    writeFileSync(f, JSON.stringify({ version: 70, enable_vsync: true, input_config: [{ backend: 'WindowKeyboard', id: '0', player_index: 'Player1' }, { backend: 'WindowKeyboard', id: '0', player_index: 'Player2' }] }))
    map('ryujinx', H, WOLF_PAD)
    const c = JSON.parse(read(f))
    assert.equal(c.version, 70)
    assert.equal(c.enable_vsync, true)
    assert.equal(c.input_config[0].id, '0-00000003-045e-0000-ea02-000008040000')
    assert.equal(c.input_config[1].player_index, 'Player2')
    c.input_config[0].id = '0-something-else'
    writeFileSync(f, JSON.stringify(c))
    map('ryujinx', H, SELKIES_PAD)
    assert.equal(JSON.parse(read(f)).input_config[0].id, '0-something-else', 'a player’s own pad stays')
  })
})
