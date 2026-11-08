// The first controller in each emulator: which virtual pad is there, and the
// mapping each emulator gets for it, in its own config format.
//
// Two virtual pads matter. Browser play (Selkies) turns the browser's gamepads
// into "Microsoft X-Box 360 pad"s that apps reach through Selkies' interposer and
// stand-in udev; Moonlight (Wolf) makes a real uinput "Wolf X-Box One (virtual) pad"
// (inputtino: 045e:02ea, version 0x0408), Wolf's pad for every client unless it
// sends motion (then a DualSense) or asks for a Nintendo pad.
//
// The identities below are what the emulators' own SDL reports, measured with
// SDL 2.30 and SDL 3 against both pads: through Selkies' stand-in udev SDL reads
// vendor and product as zero, so its GUID is the name-based kind. Both pads have
// the same buttons and axes (evdev order), so raw indexes are the same:
// buttons south 0, east 1, west 2, north 3, LB 4, RB 5, back 6, start 7, guide 8,
// left stick 9, right stick 10; axes left X 0, left Y 1, LT 2, right X 3,
// right Y 4, RT 5; the d-pad is hat 0.
//
// Nintendo consoles get a position-based layout: the button where the Switch
// has A (east) is A, and so on.
//
// A mapping is (re)written only while it isn't the player's: the part Finesse
// writes is missing, is exactly the emulator's own first-start default, is
// unchanged since Finesse wrote it (a stamp in ~/.config/finesse/pads), or is
// exactly what Finesse writes for one of the virtual pads. Anything else (a
// custom keyboard mapping, another controller, a PCSX2 Guitar) is left alone.

export interface VirtualPad {
  id: 'selkies' | 'wolf'
  /** The kernel's (evdev) name. */
  name: string
  /** The name SDL's gamepad API gives it (Dolphin and RPCS3 name devices by it). */
  gamepad: string
  /** SDL's GUID, as SDL_GUIDToString writes it (bytes 2-3 are the name's CRC). */
  guid: string
}

export const SELKIES_PAD: VirtualPad = { id: 'selkies', name: 'Microsoft X-Box 360 pad', gamepad: 'Microsoft X-Box 360 pad', guid: '000081b84d6963726f736f6674205800' }
export const WOLF_PAD: VirtualPad = { id: 'wolf', name: 'Wolf X-Box One (virtual) pad', gamepad: 'Xbox One S Controller', guid: '030015655e040000ea02000008040000' }
export const padFor = (browser: boolean | undefined) => (browser ? SELKIES_PAD : WOLF_PAD)

/** Eden (like yuzu) clears the name CRC from the GUID. */
export const edenGuid = (p: VirtualPad) => `${p.guid.slice(0, 4)}0000${p.guid.slice(8)}`

/** Every virtual pad Finesse writes mappings for: what it wrote for any of them is still its own. */
const PADS = [SELKIES_PAD, WOLF_PAD]

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
/** Key/value lines for the launch script's iniset (key, a tab, the value). */
const pairs = (kv: [string, string][]) => `printf '%s\\t%s\\n' ${kv.map(([k, v]) => `${sq(k)} ${sq(v)}`).join(' ')}`

// ---------- Whose mapping is it ----------

/** The part of a config Finesse writes, as the launch script reads it back: "key<TAB>value" lines. */
export const region = (kv: [string, string][]) => kv.map(([k, v]) => `${k}\t${v}`).join('\n')

/** An emulator's first-start default for those keys: accepted values per key ('' is "not there", '~re' a regular expression). */
export type Factory = [string, string[]][]
const spec = (f: Factory) => f.map(([k, alts]) => [k, ...alts].join('\t')).join('\n')

/** Where Finesse keeps a hash of what it last wrote for one mapping. */
export const stampFile = (H: string, name: string) => `${H}/.config/finesse/pads/${name}.sum`

/**
 * The shell condition "this mapping is Finesse's to write": `$r` holds the region read now.
 * Missing, the factory default, unchanged since Finesse's stamp, or exactly one of Finesse's own writes.
 */
const mine = (stamp: string, ours: string[], factory?: Factory) =>
  `{ padmine "$r" ${sq(stamp)} ${ours.map(sq).join(' ')}${factory ? ` || printf '%s\\n' "$r" | padfactory ${sq(spec(factory))}` : ''}; }`

// ---------- Eden (Switch) ----------

export function edenControls(p: VirtualPad): [string, string][] {
  const g = edenGuid(p)
  const sdl = (rest: string) => `"engine:sdl,port:0,guid:${g},${rest}"`
  const buttons: [string, string][] = [
    ['a', 'button:1'], ['b', 'button:0'], ['x', 'button:3'], ['y', 'button:2'],
    ['l', 'button:4'], ['r', 'button:5'],
    ['zl', 'axis:2,threshold:0.500000,invert:+'], ['zr', 'axis:5,threshold:0.500000,invert:+'],
    ['minus', 'button:6'], ['plus', 'button:7'], ['home', 'button:8'],
    ['lstick', 'button:9'], ['rstick', 'button:10'],
    ['dup', 'hat:0,direction:up'], ['ddown', 'hat:0,direction:down'], ['dleft', 'hat:0,direction:left'], ['dright', 'hat:0,direction:right'],
  ]
  const stick = (x: number, y: number) => sdl(`axis_x:${x},offset_x:-0.000000,axis_y:${y},offset_y:-0.000000,invert_x:+,invert_y:+,deadzone:0.150000,range:1.000000`)
  const kv: [string, string][] = [
    ['player_0_type', '0'],
    ['player_0_connected', 'true'],
    ...buttons.map(([k, v]): [string, string] => [`player_0_button_${k}`, sdl(v)]),
    ['player_0_lstick', stick(0, 1)],
    ['player_0_rstick', stick(3, 4)],
  ]
  // QSettings keeps a "<key>\default" beside each key; false means "set by someone".
  return kv.flatMap(([k, v]): [string, string][] => [[`${k}\\default`, 'false'], [k, v]])
}

/** Eden (QSettings) marks every value still at its default with "<key>\\default=true": its first-start default is all of them so. */
export const edenFactory = (p: VirtualPad): Factory => edenControls(p).map(([k]) => [k, k.endsWith('\\default') ? ['', 'true'] : ['~']])

const edenController = (H: string, p: VirtualPad, stampOnly = false) => {
  const f = `${H}/.config/eden/qt-config.ini`
  const keys = edenControls(p).map(([k]) => k)
  const read = `r=$(iniregion "$f" Controls ${keys.map(sq).join(' ')})`
  // No update checks or "stop the game?" questions in a game started from Finesse, unless the player set them.
  const ui = EDEN_UI.map(([k, v]) => `[ "$(iniget "$f" UI ${sq(`${k}\\default`)})" = false ] || ${pairs([[`${k}\\default`, 'false'], [k, v]])} | iniset "$f" UI '='`)
  const st = stampFile(H, 'eden')
  if (stampOnly) return `f=${sq(f)}; ${read}; padstamp ${sq(st)} "$r"`
  return [`f=${sq(f)}; ${read}; if ${mine(st, PADS.map((q) => region(edenControls(q))), edenFactory(p))}; then ${pairs(edenControls(p))} | iniset "$f" Controls '='; ${read}; padstamp ${sq(st)} "$r"; fi`, ...ui].join('\n')
}

/** Eden's [UI] settings for a kiosk game: never ask before stopping (2), no update checks. */
export const EDEN_UI: [string, string][] = [['confirmStop', '2'], ['check_for_updates', 'false']]

// ---------- Ryujinx (Switch) ----------

/** Ryujinx's id for the first pad: "<index>-<GUID as .NET formats it>", with the CRC part zeroed. */
export function ryujinxId(p: VirtualPad): string {
  const b = Buffer.from(p.guid, 'hex')
  const h = (o: number, n: number, le: boolean) => {
    const s = b.subarray(o, o + n)
    return Buffer.from(le ? [...s].reverse() : s).toString('hex')
  }
  const s = `${h(0, 4, true)}-${h(4, 2, true)}-${h(6, 2, true)}-${h(8, 2, false)}-${h(10, 6, false)}`
  return `0-0000${s.slice(4)}`
}

export function ryujinxInput(p: VirtualPad) {
  return {
    left_joycon_stick: { joystick: 'Left', invert_stick_x: false, invert_stick_y: false, rotate90_cw: false, stick_button: 'LeftStick' },
    right_joycon_stick: { joystick: 'Right', invert_stick_x: false, invert_stick_y: false, rotate90_cw: false, stick_button: 'RightStick' },
    deadzone_left: 0.1,
    deadzone_right: 0.1,
    range_left: 1,
    range_right: 1,
    trigger_threshold: 0.5,
    motion: { motion_backend: 'GamepadDriver', sensitivity: 100, gyro_deadzone: 1, enable_motion: false },
    rumble: { strong_rumble: 1, weak_rumble: 1, enable_rumble: false },
    left_joycon: { button_minus: 'Back', button_l: 'LeftShoulder', button_zl: 'LeftTrigger', button_sl: 'Unbound', button_sr: 'Unbound', dpad_up: 'DpadUp', dpad_down: 'DpadDown', dpad_left: 'DpadLeft', dpad_right: 'DpadRight' },
    // Position-based: Switch A is the east button (SDL's "B"), and so on.
    right_joycon: { button_plus: 'Start', button_r: 'RightShoulder', button_zr: 'RightTrigger', button_sl: 'Unbound', button_sr: 'Unbound', button_x: 'Y', button_b: 'A', button_y: 'X', button_a: 'B' },
    version: 1,
    backend: 'GamepadSDL2',
    id: ryujinxId(p),
    controller_type: 'ProController',
    player_index: 'Player1',
  }
}

/** Ryujinx's first-start Player 1: the keyboard, with its default keys. */
export const RYUJINX_KEYBOARD = {
  backend: 'WindowKeyboard',
  id: '0',
  controller_type: 'ProController',
  left_joycon_stick: { stick_up: 'W', stick_down: 'S', stick_left: 'A', stick_right: 'D', stick_button: 'F' },
  right_joycon_stick: { stick_up: 'I', stick_down: 'K', stick_left: 'J', stick_right: 'L', stick_button: 'H' },
  left_joycon: { button_minus: 'Minus', button_l: 'E', button_zl: 'Q', button_sl: 'Unbound', button_sr: 'Unbound', dpad_up: 'Up', dpad_down: 'Down', dpad_left: 'Left', dpad_right: 'Right' },
  right_joycon: { button_plus: 'Plus', button_r: 'U', button_zr: 'O', button_sl: 'Unbound', button_sr: 'Unbound', button_x: 'C', button_b: 'X', button_y: 'V', button_a: 'Z' },
}

const ryujinxController = (H: string, p: VirtualPad) => {
  // Ryujinx writes its whole Config.json on first start; Player 1 then gets the pad while it's
  // Ryujinx's keyboard default (every key as Ryujinx sets it), what Finesse wrote (unchanged since,
  // by the stamp, or exactly Finesse's mapping for a virtual pad), or missing. Python is in both images.
  const py = [
    'import json,sys,os,hashlib',
    'f,new,ours,factory,st=sys.argv[1],json.loads(sys.argv[2]),json.loads(sys.argv[3]),json.loads(sys.argv[4]),sys.argv[5]',
    'c=json.load(open(f))',
    'ins=c.get("input_config") or []',
    'p1=[i for i in ins if i.get("player_index")=="Player1"]',
    'canon=lambda x: json.dumps(x,sort_keys=True)',
    'h=lambda x: hashlib.sha256(canon(x).encode()).hexdigest()',
    'stamp=open(st).read().strip() if os.path.exists(st) else None',
    'def mine(i):',
    ' if any(canon(i)==canon(o) for o in ours): return True',
    ' if stamp and h(i)==stamp: return True',
    ' return all(i.get(k)==v for k,v in factory.items())',
    'if not p1 or mine(p1[0]):',
    ' c["input_config"]=[new]+[i for i in ins if i.get("player_index")!="Player1"]',
    ' t=f+".tmp"; json.dump(c,open(t,"w"),indent=2); os.replace(t,f)',
    ' os.makedirs(os.path.dirname(st),exist_ok=True); open(st,"w").write(h(new))',
  ].join('\n')
  const f = `${H}/.config/Ryujinx/Config.json`
  return `f=${sq(f)}; [ -f "$f" ] && command -v python3 >/dev/null && python3 -c ${sq(py)} "$f" ${sq(JSON.stringify(ryujinxInput(p)))} ${sq(JSON.stringify(PADS.map(ryujinxInput)))} ${sq(JSON.stringify(RYUJINX_KEYBOARD))} ${sq(stampFile(H, 'ryujinx'))} || true`
}

// ---------- Dolphin (GameCube, Wii) ----------

const dolphinDevice = (p: VirtualPad) => `SDL/0/${p.gamepad}`
const bt = (s: string) => `\`${s}\``

export function dolphinGCPad(p: VirtualPad): [string, string][] {
  // Dolphin names SDL inputs after the button's place ("Button S"…), and its "Y+" is up.
  // GameCube: the big A is the south button, B west, X east, Y north.
  return [
    ['Device', dolphinDevice(p)],
    ['Buttons/A', bt('Button S')], ['Buttons/B', bt('Button W')], ['Buttons/X', bt('Button E')], ['Buttons/Y', bt('Button N')],
    ['Buttons/Z', bt('Shoulder R')], ['Buttons/Start', 'Start'],
    ['Main Stick/Up', bt('Left Y+')], ['Main Stick/Down', bt('Left Y-')], ['Main Stick/Left', bt('Left X-')], ['Main Stick/Right', bt('Left X+')],
    ['Main Stick/Modifier', bt('Thumb L')],
    ['C-Stick/Up', bt('Right Y+')], ['C-Stick/Down', bt('Right Y-')], ['C-Stick/Left', bt('Right X-')], ['C-Stick/Right', bt('Right X+')],
    ['Triggers/L', bt('Trigger L')], ['Triggers/R', bt('Trigger R')], ['Triggers/L-Analog', bt('Trigger L')], ['Triggers/R-Analog', bt('Trigger R')],
    ['D-Pad/Up', bt('Pad N')], ['D-Pad/Down', bt('Pad S')], ['D-Pad/Left', bt('Pad W')], ['D-Pad/Right', bt('Pad E')],
    ['Rumble/Motor', bt('Motor')],
  ]
}

export function dolphinWiimote(p: VirtualPad): [string, string][] {
  // A Wii Remote with a Nunchuk (what most Wii games want): A south, B on the right trigger,
  // 1 west, 2 east; the pointer on the right stick; the Nunchuk's stick, C and Z on the left.
  return [
    ['Device', dolphinDevice(p)],
    ['Source', '1'],
    ['Extension', 'Nunchuk'],
    ['Buttons/A', bt('Button S')], ['Buttons/B', bt('Trigger R')], ['Buttons/1', bt('Button W')], ['Buttons/2', bt('Button E')],
    ['Buttons/-', 'Back'], ['Buttons/+', 'Start'], ['Buttons/Home', 'Guide'],
    ['D-Pad/Up', bt('Pad N')], ['D-Pad/Down', bt('Pad S')], ['D-Pad/Left', bt('Pad W')], ['D-Pad/Right', bt('Pad E')],
    ['IR/Up', bt('Right Y+')], ['IR/Down', bt('Right Y-')], ['IR/Left', bt('Right X-')], ['IR/Right', bt('Right X+')],
    ['Shake/X', bt('Button N')], ['Shake/Y', bt('Button N')], ['Shake/Z', bt('Button N')],
    ['Rumble/Motor', bt('Motor')],
    ['Nunchuk/Buttons/C', bt('Shoulder L')], ['Nunchuk/Buttons/Z', bt('Trigger L')],
    ['Nunchuk/Stick/Up', bt('Left Y+')], ['Nunchuk/Stick/Down', bt('Left Y-')], ['Nunchuk/Stick/Left', bt('Left X-')], ['Nunchuk/Stick/Right', bt('Left X+')],
    ['Nunchuk/Shake/X', bt('Thumb L')], ['Nunchuk/Shake/Y', bt('Thumb L')], ['Nunchuk/Shake/Z', bt('Thumb L')],
  ]
}

/** Dolphin's settings for a game started from Finesse: fullscreen, no questions, a sensible renderer. Only keys the player hasn't set. */
export const DOLPHIN_SETTINGS: { file: string; section: string; kv: [string, string][] }[] = [
  { file: 'Dolphin.ini', section: 'Display', kv: [['Fullscreen', 'True'], ['RenderToMain', 'False']] },
  { file: 'Dolphin.ini', section: 'Interface', kv: [['ConfirmStop', 'False'], ['ShowActiveTitle', 'False'], ['SkipNKitWarning', 'True']] },
  { file: 'Dolphin.ini', section: 'Analytics', kv: [['PermissionAsked', 'True'], ['Enabled', 'False']] },
  { file: 'Dolphin.ini', section: 'AutoUpdate', kv: [['UpdateTrack', '']] },
  { file: 'Dolphin.ini', section: 'Core', kv: [['SIDevice0', '6']] },
  // The pad keeps working when the game's window isn't the focused one (a dialog, a click in the browser).
  { file: 'Dolphin.ini', section: 'Input', kv: [['BackgroundInput', 'True']] },
  { file: 'GFX.ini', section: 'Settings', kv: [['ShaderCompilationMode', '2'], ['WaitForShadersBeforeStarting', 'True']] },
]

// Dolphin's own first-start defaults (GCPadEmu.cpp, WiimoteEmu.cpp, Nunchuk.cpp, Linux): the keyboard and mouse.
const KB_DEVICE = ['', '~^XInput2/']
const factoryFor = (keys: string[], defaults: Record<string, string[]>): Factory => keys.map((k) => [k, defaults[k] ?? ['']])
export const DOLPHIN_GC_FACTORY: Record<string, string[]> = {
  Device: KB_DEVICE,
  'Buttons/A': ['`X`'], 'Buttons/B': ['`Z`'], 'Buttons/X': ['`C`'], 'Buttons/Y': ['`S`'], 'Buttons/Z': ['`D`'], 'Buttons/Start': ['`Return`'],
  'Main Stick/Up': ['`Up`'], 'Main Stick/Down': ['`Down`'], 'Main Stick/Left': ['`Left`'], 'Main Stick/Right': ['`Right`'], 'Main Stick/Modifier': ['`Shift`'],
  'C-Stick/Up': ['`I`'], 'C-Stick/Down': ['`K`'], 'C-Stick/Left': ['`J`'], 'C-Stick/Right': ['`L`'],
  'Triggers/L': ['`Q`'], 'Triggers/R': ['`W`'],
  'D-Pad/Up': ['`T`'], 'D-Pad/Down': ['`G`'], 'D-Pad/Left': ['`F`'], 'D-Pad/Right': ['`H`'],
}
export const DOLPHIN_WII_FACTORY: Record<string, string[]> = {
  Device: KB_DEVICE,
  Source: ['', '1'],
  Extension: ['', 'Nunchuk'],
  'Buttons/A': ['`Click 1`'], 'Buttons/B': ['`Click 3`'], 'Buttons/1': ['`1`'], 'Buttons/2': ['`2`'], 'Buttons/-': ['Q'], 'Buttons/+': ['E'], 'Buttons/Home': ['Return'],
  'D-Pad/Up': ['Up'], 'D-Pad/Down': ['Down'], 'D-Pad/Left': ['Left'], 'D-Pad/Right': ['Right'],
  'IR/Up': ['`Cursor Y-`'], 'IR/Down': ['`Cursor Y+`'], 'IR/Left': ['`Cursor X-`'], 'IR/Right': ['`Cursor X+`'],
  'Shake/X': ['`Click 2`'], 'Shake/Y': ['`Click 2`'], 'Shake/Z': ['`Click 2`'],
  'Nunchuk/Buttons/C': ['Control_L'], 'Nunchuk/Buttons/Z': ['Shift_L'],
  'Nunchuk/Stick/Up': ['W'], 'Nunchuk/Stick/Down': ['S'], 'Nunchuk/Stick/Left': ['A'], 'Nunchuk/Stick/Right': ['D'],
  'Nunchuk/Shake/X': ['`Click 2`'], 'Nunchuk/Shake/Y': ['`Click 2`'], 'Nunchuk/Shake/Z': ['`Click 2`'],
}

const dolphinController = (H: string, p: VirtualPad, stampOnly = false) => {
  const dir = `${H}/.config/dolphin-emu`
  const ours = (file: string, section: string, name: string, gen: (q: VirtualPad) => [string, string][], defaults: Record<string, string[]>) => {
    const keys = gen(p).map(([k]) => k)
    const read = `r=$(iniregion "$f" ${sq(section)} ${keys.map(sq).join(' ')})`
    const st = stampFile(H, name)
    if (stampOnly) return `f=${sq(`${dir}/${file}`)}; ${read}; padstamp ${sq(st)} "$r"`
    return `f=${sq(`${dir}/${file}`)}; ${read}; if ${mine(st, PADS.map((q) => region(gen(q))), factoryFor(keys, defaults))}; then ${pairs(gen(p))} | iniset "$f" ${sq(section)} ' = '; ${read}; padstamp ${sq(st)} "$r"; fi`
  }
  return [
    ours('GCPadNew.ini', 'GCPad1', 'dolphin-gc', dolphinGCPad, DOLPHIN_GC_FACTORY),
    ours('WiimoteNew.ini', 'Wiimote1', 'dolphin-wii', dolphinWiimote, DOLPHIN_WII_FACTORY),
    ...(stampOnly ? [] : DOLPHIN_EXTRA(dir)),
  ].join('\n')
}

/** Dolphin's settings for a game started from Finesse (only keys the player hasn't set), and its renderer. */
const DOLPHIN_EXTRA = (dir: string) => [
  ...DOLPHIN_SETTINGS.map((s) => `${pairs(s.kv)} | iniset ${sq(`${dir}/${s.file}`)} ${sq(s.section)} ' = ' keep`),
  // The graphics card draws when there is one (Vulkan, twice the native resolution); otherwise OpenGL at native.
  `if [ -e /dev/nvidiactl ] || compgen -G '/dev/dri/renderD*' >/dev/null; then gb=Vulkan; ir=2; else gb=OGL; ir=1; fi; printf '%s\\t%s\\n' GFXBackend "$gb" | iniset ${sq(`${dir}/Dolphin.ini`)} Core ' = ' keep; printf '%s\\t%s\\n' InternalResolution "$ir" | iniset ${sq(`${dir}/GFX.ini`)} Settings ' = ' keep`,
]

// ---------- RPCS3 (PS3) ----------

/** RPCS3's input config: Player 1 on SDL's first pad; RPCS3 fills in its own SDL defaults (Cross = south…). */
export function rpcs3Input(p: VirtualPad): string {
  return ['Player 1 Input:', '  Handler: SDL', `  Device: ${p.gamepad} 1`, ''].join('\n')
}

/** RPCS3's first-start Player 1 (keyboard_pad_handler.cpp): the keyboard, with these keys (Qt's names for them). */
export const RPCS3_KEYBOARD: Record<string, string[]> = {
  Handler: ['Keyboard'], Device: ['Keyboard'],
  'Left Stick Left': ['A'], 'Left Stick Down': ['S'], 'Left Stick Right': ['D'], 'Left Stick Up': ['W'],
  'Right Stick Left': ['Del', 'Delete'], 'Right Stick Down': ['End'], 'Right Stick Right': ['PgDown', 'Page Down'], 'Right Stick Up': ['Home'],
  Start: ['Return'], Select: ['Space'], 'PS Button': ['Backspace'],
  Square: ['Z'], Cross: ['X'], Circle: ['C'], Triangle: ['V'],
  Left: ['Left'], Down: ['Down'], Right: ['Right'], Up: ['Up'],
  R1: ['E'], R2: ['T'], R3: ['G'], L1: ['Q'], L2: ['R'], L3: ['F'],
}
const RPCS3_KEYS = Object.keys(RPCS3_KEYBOARD)
/** Player 1's handler, device and button bindings, as the launch script reads them (the region of RPCS3_KEYS). */
export const rpcs3Region = (handler: string, device: string, binds: Record<string, string> = {}) =>
  region(RPCS3_KEYS.map((k): [string, string] => [k, k === 'Handler' ? handler : k === 'Device' ? device : (binds[k] ?? '')]))

const rpcs3Controller = (H: string, p: VirtualPad, stampOnly = false) => {
  const f = `${H}/.config/rpcs3/input_configs/global/Default.yml`
  // Player 1's block: "  Handler:", "  Device:" and its "    <button>:" lines under "  Config:".
  const awk = `BEGIN{n=split(ENVIRON["K"],ks,"\\n")} { l=$0; sub(/\\r$/,"",l) } l ~ /^Player 1 Input:/ {s=1; next} l ~ /^[^ ]/ {s=0} s { if (match(l, /^  (Handler|Device): */)) { k=substr(l,3,index(l,":")-3); v[k]=substr(l,RLENGTH+1) } else if (match(l, /^    [^ :][^:]*: */)) { k=substr(l,5,index(l,":")-5); if (!(k in v)) v[k]=substr(l,RLENGTH+1) } } END { for (i=1;i<=n;i++) { x=v[ks[i]]; gsub(/^"|"$/,"",x); printf "%s\\t%s%s", ks[i], x, (i<n?"\\n":"") } }`
  const read = `r=$([ -f "$f" ] && K=${sq(RPCS3_KEYS.join('\n'))} awk ${sq(awk)} "$f" || true)`
  const replace = `{ printf '%s' ${sq(rpcs3Input(p))}; if [ -f "$f" ]; then awk '/^Player 1 Input:/{s=1;next} /^[^ ]/{s=0} !s' "$f"; fi; } > "$f.tmp" && mv "$f.tmp" "$f"`
  const st = stampFile(H, 'rpcs3')
  const ours = PADS.map((q) => rpcs3Region('SDL', `${q.gamepad} 1`))
  if (stampOnly) return `f=${sq(f)}; ${read}; padstamp ${sq(st)} "$r"`
  return `f=${sq(f)}; ${read}; if ${mine(st, ours, RPCS3_KEYS.map((k): [string, string[]] => [k, RPCS3_KEYBOARD[k]!]))}; then mkdir -p "$(dirname "$f")"; ${replace}; ${read}; padstamp ${sq(st)} "$r"; fi`
}

// ---------- Cemu (Wii U) ----------

// Cemu's mapping ids (VPADController) → its SDL "buttons" (SDL game controller buttons, then its axis codes).
const CEMU_VPAD: [number, number][] = [
  [1, 1], [2, 0], [3, 3], [4, 2], // A east, B south, X north, Y west (where the Wii U has them)
  [5, 9], [6, 10], [7, 42], [8, 43], // L, R, ZL and ZR on the triggers
  [9, 6], [10, 4], [27, 5], // +, −, Home
  [11, 11], [12, 12], [13, 13], [14, 14], // d-pad
  [15, 7], [16, 8], // stick clicks
  [17, 45], [18, 39], [19, 44], [20, 38], // left stick up, down, left, right
  [21, 47], [22, 41], [23, 46], [24, 40], // right stick
]

/** Cemu's settings for a first start from Finesse: fullscreen, no update checks or one-time prompts (the rest are Cemu's defaults). */
export const CEMU_SETTINGS = ['<?xml version="1.0" encoding="UTF-8"?>', '<content>', '\t<check_update>false</check_update>', '\t<gp_download>true</gp_download>', '\t<vk_warning>true</vk_warning>', '\t<fullscreen>true</fullscreen>', '</content>', ''].join('\n')

export function cemuController(p: VirtualPad): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<emulated_controller>',
    '\t<type>Wii U GamePad</type>',
    '\t<controller>',
    '\t\t<api>SDLController</api>',
    `\t\t<uuid>0_${p.guid}</uuid>`,
    `\t\t<display_name>${p.gamepad}</display_name>`,
    '\t\t<rumble>0</rumble>',
    '\t\t<axis><deadzone>0.25</deadzone><range>1</range></axis>',
    '\t\t<rotation><deadzone>0.25</deadzone><range>1</range></rotation>',
    '\t\t<trigger><deadzone>0.25</deadzone><range>1</range></trigger>',
    '\t\t<mappings>',
    ...CEMU_VPAD.map(([m, b]) => `\t\t\t<entry><mapping>${m}</mapping><button>${b}</button></entry>`),
    '\t\t</mappings>',
    '\t</controller>',
    '</emulated_controller>',
    '',
  ].join('\n')
}

/** A Cemu profile as the launch script reads it back (no indentation; no last newline). */
export const cemuRegion = (xml: string) => xml.replace(/\r$/gm, '').replace(/^[ \t]+/gm, '').replace(/\n+$/, '')

const cemuControllerShell = (H: string, p: VirtualPad, stampOnly = false) => {
  const f = `${H}/.config/Cemu/controllerProfiles/controller0.xml`
  // Without a settings.xml Cemu opens its "first time" assistant instead of the game.
  const settings = `${H}/.config/Cemu/settings.xml`
  // Cemu writes no profile of its own: the player's is any with a controller in it that Finesse didn't write.
  const read = `r=$([ -f "$f" ] && grep -q '<controller>' "$f" && sed -e 's/\\r$//' -e 's/^[[:space:]]*//' "$f" || true)`
  const st = stampFile(H, 'cemu')
  if (stampOnly) return `f=${sq(f)}; ${read}; padstamp ${sq(st)} "$r"`
  return `[ -e ${sq(settings)} ] || { mkdir -p ${sq(`${H}/.config/Cemu`)}; printf '%s' ${sq(CEMU_SETTINGS)} > ${sq(settings)}; }\nf=${sq(f)}; ${read}; if ${mine(st, PADS.map((q) => cemuRegion(cemuController(q))))}; then mkdir -p "$(dirname "$f")"; printf '%s' ${sq(cemuController(p))} > "$f"; ${read}; padstamp ${sq(st)} "$r"; fi`
}

// ---------- PCSX2 (PS2) ----------

// Player 1 on SDL's first controller, with PCSX2 2.x's names for the face buttons (FaceSouth…):
// its old A/B/X/Y are "invalid bindings" now. PCSX2 names pads by index, so both virtual pads work.
const PCSX2_PAD1 = ['[Pad1]', 'Type = DualShock2', 'Up = SDL-0/DPadUp', 'Right = SDL-0/DPadRight', 'Down = SDL-0/DPadDown', 'Left = SDL-0/DPadLeft', 'Triangle = SDL-0/FaceNorth', 'Circle = SDL-0/FaceEast', 'Cross = SDL-0/FaceSouth', 'Square = SDL-0/FaceWest', 'Select = SDL-0/Back', 'Start = SDL-0/Start', 'L1 = SDL-0/LeftShoulder', 'L2 = SDL-0/+LeftTrigger', 'R1 = SDL-0/RightShoulder', 'R2 = SDL-0/+RightTrigger', 'L3 = SDL-0/LeftStick', 'R3 = SDL-0/RightStick', 'LUp = SDL-0/-LeftY', 'LRight = SDL-0/+LeftX', 'LDown = SDL-0/+LeftY', 'LLeft = SDL-0/-LeftX', 'RUp = SDL-0/-RightY', 'RRight = SDL-0/+RightX', 'RDown = SDL-0/+RightY', 'RLeft = SDL-0/-RightX', 'Analog = SDL-0/Guide', 'LargeMotor = SDL-0/LargeMotor', 'SmallMotor = SDL-0/SmallMotor']
export const pcsx2Pad1 = () => PCSX2_PAD1
const kvOf = (lines: string[]) => lines.slice(1).map((l): [string, string] => [l.slice(0, l.indexOf(' = ')), l.slice(l.indexOf(' = ') + 3)])
/** Finesse's mapping before PCSX2 2.x's face-button names (Games on Whales' A/B/X/Y): still Finesse's own. */
const PCSX2_OLD = kvOf(PCSX2_PAD1).map(([k, v]): [string, string] => [k, v.replace('FaceSouth', 'A').replace('FaceEast', 'B').replace('FaceWest', 'X').replace('FaceNorth', 'Y')])
/** PCSX2's first-start Pad1 (Pad.cpp, InputManager.cpp): a DualShock 2 on the keyboard; no analog button or motors. */
export const PCSX2_KEYBOARD: Record<string, string> = {
  Type: 'DualShock2',
  Up: 'Keyboard/Up', Right: 'Keyboard/Right', Down: 'Keyboard/Down', Left: 'Keyboard/Left',
  LUp: 'Keyboard/W', LRight: 'Keyboard/D', LDown: 'Keyboard/S', LLeft: 'Keyboard/A',
  RUp: 'Keyboard/T', RRight: 'Keyboard/H', RDown: 'Keyboard/G', RLeft: 'Keyboard/F',
  Start: 'Keyboard/Return', Select: 'Keyboard/Backspace',
  Triangle: 'Keyboard/I', Circle: 'Keyboard/L', Cross: 'Keyboard/K', Square: 'Keyboard/J',
  L1: 'Keyboard/Q', L2: 'Keyboard/1', L3: 'Keyboard/2', R1: 'Keyboard/E', R2: 'Keyboard/3', R3: 'Keyboard/4',
}
const pcsx2Controller = (H: string, stampOnly = false) => {
  const f = `${H}/.config/PCSX2/inis/PCSX2.ini`
  // A fresh PCSX2.ini needs its settings version (or PCSX2 asks to reset everything), no setup wizard,
  // and a BIOS picked from the linked ones; none of it replaces what's there.
  const base = `${pairs([['SettingsVersion', '1'], ['SetupWizardIncomplete', 'false'], ['ConfirmShutdown', 'false']])} | iniset ${sq(f)} UI ' = ' keep; bios=$(d=${sq(`${H}/.config/PCSX2/bios`)}; { ls "$d" | grep -i -E '^scph.*\\.bin$'; ls "$d" | grep -i -E '\\.(bin|rom0)$'; } 2>/dev/null | head -n1 || true); [ -z "$bios" ] || printf 'BIOS\\t%s\\n' "$bios" | iniset ${sq(f)} Filenames ' = ' keep`
  const kv = kvOf(PCSX2_PAD1)
  const keys = kv.map(([k]) => k)
  const read = `r=$(iniregion "$f" Pad1 ${keys.map(sq).join(' ')})`
  const st = stampFile(H, 'pcsx2')
  if (stampOnly) return `f=${sq(f)}; ${read}; padstamp ${sq(st)} "$r"`
  // Only Finesse's keys change; the rest of [Pad1] (deadzones, another pad type's settings) stays.
  return `${base}\nf=${sq(f)}; ${read}; if ${mine(st, [region(kv), region(PCSX2_OLD)], keys.map((k): [string, string[]] => [k, [PCSX2_KEYBOARD[k] ?? '']]))}; then ${pairs(kv)} | iniset "$f" Pad1 ' = '; ${read}; padstamp ${sq(st)} "$r"; fi`
}

// ---------- The launch script's side ----------

export type ControllerId = 'pcsx2' | 'dolphin' | 'rpcs3' | 'cemu' | 'eden' | 'ryujinx'

/** The shell that maps the first pad for one emulator (run as the app's user, before it starts). */
export function controllerShell(id: Exclude<ControllerId, 'ryujinx'>, H: string, p: VirtualPad, opts?: { stampOnly: true }): string
export function controllerShell(id: ControllerId, H: string, p: VirtualPad): string
export function controllerShell(id: ControllerId, H: string, p: VirtualPad, opts: { stampOnly?: boolean } = {}): string {
  // stampOnly: only remember what's there now as Finesse's write (tests use it to play an older Finesse).
  const only = Boolean(opts.stampOnly)
  switch (id) {
    case 'pcsx2':
      return pcsx2Controller(H, only)
    case 'dolphin':
      return dolphinController(H, p, only)
    case 'rpcs3':
      return rpcs3Controller(H, p, only)
    case 'cemu':
      return cemuControllerShell(H, p, only)
    case 'eden':
      return edenController(H, p, only)
    case 'ryujinx':
      return ryujinxController(H, p)
  }
}

/**
 * Shell helpers for the mappings: iniget FILE SECTION KEY prints a key's value;
 * `… | iniset FILE SECTION SEP [keep]` sets the "key<TAB>value" lines it reads in that
 * section (keep: only keys that aren't there yet), adding the section when it's missing.
 */
export const INI_HELPERS = [
  `iniget() { [ -f "$1" ] || return 0; S="$2" K="$3" awk 'BEGIN{s="["ENVIRON["S"]"]"} { l=$0; sub(/\\r$/,"",l) } l ~ /^\\[.*\\]$/ { in_s=(l==s); next } in_s { i=index(l,"="); if (i) { k=substr(l,1,i-1); gsub(/^[ \\t]+|[ \\t]+$/,"",k); if (k==ENVIRON["K"]) { v=substr(l,i+1); sub(/^[ \\t]+/,"",v); print v; exit } } }' "$1"; }`,
  // iniregion FILE SECTION KEY…: "key<TAB>value" for each key, in order (empty when it isn't there).
  `iniregion() { local f=$1 s=$2; shift 2; local k; K=$(for k in "$@"; do printf '%s\\n' "$k"; done) S="$s" awk 'BEGIN{s="["ENVIRON["S"]"]"; n=split(ENVIRON["K"],ks,"\\n")} { l=$0; sub(/\\r$/,"",l) } l ~ /^\\[.*\\]$/ { in_s=(l==s); next } in_s { i=index(l,"="); if (i) { k=substr(l,1,i-1); gsub(/^[ \\t]+|[ \\t]+$/,"",k); if (!(k in v)) { x=substr(l,i+1); sub(/^[ \\t]+/,"",x); v[k]=x } } } END { for (i=1;i<=n;i++) printf "%s\\t%s%s", ks[i], v[ks[i]], (i<n?"\\n":"") }' "$f" 2>/dev/null || true; }`,
  // padmine REGION STAMP OURS…: the region is missing (no values), unchanged since Finesse's stamp, or exactly one of Finesse's writes.
  `padmine() { local r=$1 st=$2 g; shift 2; [ -z "$(printf '%s\\n' "$r" | cut -f2- | tr -d '\\n')" ] && return 0; [ -f "$st" ] && [ "$(printf '%s' "$r" | cksum)" = "$(cat "$st")" ] && return 0; for g in "$@"; do [ "$r" = "$g" ] && return 0; done; return 1; }`,
  // … | padfactory SPEC: every key's value is one the emulator's first start writes (SPEC: "key<TAB>value<TAB>value…"; "" is not there, ~re a regular expression).
  `padfactory() { SPEC="$1" awk -F '\\t' 'BEGIN{ n=split(ENVIRON["SPEC"],ls,"\\n"); for (i=1;i<=n;i++) { m=split(ls[i],f,"\\t"); alts[f[1]]=m-1; for (j=2;j<=m;j++) alt[f[1],j-1]=f[j] } ok=1 } { k=$1; v=substr($0,length(k)+2); good=0; for (j=1;j<=alts[k];j++) { a=alt[k,j]; if (substr(a,1,1)=="~") { if (v ~ substr(a,2)) good=1 } else if (v==a) good=1 } if (!good) ok=0 } END { exit !ok }'; }`,
  // padstamp STAMP REGION: remembers what Finesse just wrote.
  `padstamp() { mkdir -p "$(dirname "$1")"; printf '%s' "$2" | cksum > "$1"; }`,
  `iniset() { local f=$1; mkdir -p "$(dirname "$f")"; [ -f "$f" ] || : > "$f"; S="$2" SEP="$3" KEEP="\${4:-}" awk -F '\\t' 'BEGIN{s="["ENVIRON["S"]"]"; sep=ENVIRON["SEP"]; keep=(ENVIRON["KEEP"]!="")} FNR==NR { if (NF>=2) { n++; key[n]=$1; val[$1]=substr($0,length($1)+2) } next } function flush(  i) { for (i=1;i<=n;i++) if (!(key[i] in seen)) print key[i] sep val[key[i]]; done=1 } { l=$0; sub(/\\r$/,"",l) } l ~ /^\\[.*\\]$/ { if (in_s && !done) flush(); in_s=(l==s); if (in_s) found=1; print; next } in_s { i=index(l,"="); if (i) { k=substr(l,1,i-1); gsub(/^[ \\t]+|[ \\t]+$/,"",k); if (k in val) { if (k in seen) next; seen[k]=1; if (!keep) { print k sep val[k]; next } } } } { print } END { if (in_s && !done) flush(); else if (!found) { print ""; print s; flush() } }' - "$f" > "$f.tmp" && mv "$f.tmp" "$f"; }`,
]
