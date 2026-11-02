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
// has A (east) is A, and so on. A mapping is written only while the player has
// none of their own: no config yet, the emulator's keyboard default, or one of
// these virtual pads' identities that isn't the pad in front of it now.

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

/** Every identity Finesse ever wrote for a virtual pad (an early hand-made Eden mapping guessed the USB ids). */
const PADS = [SELKIES_PAD, WOLF_PAD]
const OLD_GUIDS = ['030000005e0400008e02000014010000']
/** The other virtual pads' GUIDs (as `fmt` writes them): a mapping for one of these is ours to replace. */
const otherGuids = (p: VirtualPad, fmt: (q: VirtualPad) => string) => [...PADS.filter((q) => q.id !== p.id).map(fmt), ...OLD_GUIDS]
const otherNames = (p: VirtualPad) => PADS.filter((q) => q.id !== p.id).map((q) => q.gamepad)

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
/** Key/value lines for the launch script's iniset (key, a tab, the value). */
const pairs = (kv: [string, string][]) => `printf '%s\\t%s\\n' ${kv.map(([k, v]) => `${sq(k)} ${sq(v)}`).join(' ')}`
/** A shell case pattern matching any of these substrings. */
const anyOf = (xs: string[]) => xs.map((x) => `*${x.replace(/[*?[\]\\'"$`\s|()&;<>]/g, (c) => `\\${c}`)}*`).join('|')

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

const edenController = (H: string, p: VirtualPad) => {
  const f = `${H}/.config/eden/qt-config.ini`
  // No update checks or "stop the game?" questions in a game started from Finesse, unless the player set them.
  const ui = EDEN_UI.map(([k, v]) => `[ "$(iniget "$f" UI ${sq(`${k}\\default`)})" = false ] || ${pairs([[`${k}\\default`, 'false'], [k, v]])} | iniset "$f" UI '='`)
  return [`f=${sq(f)}; a=$(iniget "$f" Controls 'player_0_button_a'); case "$a" in ""|*engine:keyboard*|${anyOf(otherGuids(p, edenGuid))}) ${pairs(edenControls(p))} | iniset "$f" Controls '=';; esac`, ...ui].join('\n')
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

const ryujinxController = (H: string, p: VirtualPad) => {
  // Ryujinx writes its whole Config.json on first start; from then on Player 1 gets the pad
  // while it's on the keyboard (or on the other virtual pad). Python is in both images.
  const py = [
    'import json,sys',
    'f,new,others=sys.argv[1],json.loads(sys.argv[2]),json.loads(sys.argv[3])',
    'c=json.load(open(f))',
    'ins=c.get("input_config") or []',
    'p1=[i for i in ins if i.get("player_index")=="Player1"]',
    'mine=not p1 or p1[0].get("backend")=="WindowKeyboard" or p1[0].get("id") in others',
    'if mine:',
    ' c["input_config"]=[new]+[i for i in ins if i.get("player_index")!="Player1"]',
    ' t=f+".tmp"; json.dump(c,open(t,"w"),indent=2); import os; os.replace(t,f)',
  ].join('\n')
  const f = `${H}/.config/Ryujinx/Config.json`
  return `f=${sq(f)}; [ -f "$f" ] && command -v python3 >/dev/null && python3 -c ${sq(py)} "$f" ${sq(JSON.stringify(ryujinxInput(p)))} ${sq(JSON.stringify(otherGuids(p, ryujinxId)))} || true`
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

const dolphinController = (H: string, p: VirtualPad) => {
  const dir = `${H}/.config/dolphin-emu`
  const ours = (file: string, section: string, kv: [string, string][]) =>
    `f=${sq(`${dir}/${file}`)}; d=$(iniget "$f" ${sq(section)} Device); case "$d" in ""|XInput2/*|${anyOf(otherNames(p).map((n) => `SDL/0/${n}`))}) ${pairs(kv)} | iniset "$f" ${sq(section)} ' = ';; esac`
  return [
    ours('GCPadNew.ini', 'GCPad1', dolphinGCPad(p)),
    ours('WiimoteNew.ini', 'Wiimote1', dolphinWiimote(p)),
    ...DOLPHIN_SETTINGS.map((s) => `${pairs(s.kv)} | iniset ${sq(`${dir}/${s.file}`)} ${sq(s.section)} ' = ' keep`),
    // The graphics card draws when there is one (Vulkan, twice the native resolution); otherwise OpenGL at native.
    `if [ -e /dev/nvidiactl ] || compgen -G '/dev/dri/renderD*' >/dev/null; then gb=Vulkan; ir=2; else gb=OGL; ir=1; fi; printf '%s\\t%s\\n' GFXBackend "$gb" | iniset ${sq(`${dir}/Dolphin.ini`)} Core ' = ' keep; printf '%s\\t%s\\n' InternalResolution "$ir" | iniset ${sq(`${dir}/GFX.ini`)} Settings ' = ' keep`,
  ].join('\n')
}

// ---------- RPCS3 (PS3) ----------

/** RPCS3's input config: Player 1 on SDL's first pad; RPCS3 fills in its own SDL defaults (Cross = south…). */
export function rpcs3Input(p: VirtualPad): string {
  return ['Player 1 Input:', '  Handler: SDL', `  Device: ${p.gamepad} 1`, ''].join('\n')
}

const rpcs3Controller = (H: string, p: VirtualPad) => {
  const f = `${H}/.config/rpcs3/input_configs/global/Default.yml`
  // Player 1's handler and device, from the "Player 1 Input:" block.
  const read = `awk '/^Player 1 Input:/{s=1;next} /^[^ ]/{s=0} s && /^  (Handler|Device):/{sub(/^  [A-Za-z]+: */,""); printf "%s|", $0}' "$f" 2>/dev/null || true`
  const replace = `{ printf '%s' ${sq(rpcs3Input(p))}; if [ -f "$f" ]; then awk '/^Player 1 Input:/{s=1;next} /^[^ ]/{s=0} !s' "$f"; fi; } > "$f.tmp" && mv "$f.tmp" "$f"`
  return `f=${sq(f)}; h=$(${read}); case "$h" in ""|Keyboard\\|*|Null\\|*|${anyOf(otherNames(p).map((n) => `SDL|${n} 1|`))}) mkdir -p "$(dirname "$f")"; ${replace};; esac`
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

const cemuControllerShell = (H: string, p: VirtualPad) => {
  const f = `${H}/.config/Cemu/controllerProfiles/controller0.xml`
  return `f=${sq(f)}; if [ ! -s "$f" ] || grep -q -E '<api>Keyboard</api>|${otherGuids(p, (q) => q.guid).join('|')}' "$f" || ! grep -q '<controller>' "$f"; then mkdir -p "$(dirname "$f")"; printf '%s' ${sq(cemuController(p))} > "$f"; fi`
}

// ---------- PCSX2 (PS2) ----------

// Player 1 on SDL's first controller, with PCSX2 2.x's names for the face buttons (FaceSouth…):
// its old A/B/X/Y are "invalid bindings" now. PCSX2 names pads by index, so both virtual pads work.
const PCSX2_PAD1 = ['[Pad1]', 'Type = DualShock2', 'Up = SDL-0/DPadUp', 'Right = SDL-0/DPadRight', 'Down = SDL-0/DPadDown', 'Left = SDL-0/DPadLeft', 'Triangle = SDL-0/FaceNorth', 'Circle = SDL-0/FaceEast', 'Cross = SDL-0/FaceSouth', 'Square = SDL-0/FaceWest', 'Select = SDL-0/Back', 'Start = SDL-0/Start', 'L1 = SDL-0/LeftShoulder', 'L2 = SDL-0/+LeftTrigger', 'R1 = SDL-0/RightShoulder', 'R2 = SDL-0/+RightTrigger', 'L3 = SDL-0/LeftStick', 'R3 = SDL-0/RightStick', 'LUp = SDL-0/-LeftY', 'LRight = SDL-0/+LeftX', 'LDown = SDL-0/+LeftY', 'LLeft = SDL-0/-LeftX', 'RUp = SDL-0/-RightY', 'RRight = SDL-0/+RightX', 'RDown = SDL-0/+RightY', 'RLeft = SDL-0/-RightX', 'Analog = SDL-0/Guide', 'LargeMotor = SDL-0/LargeMotor', 'SmallMotor = SDL-0/SmallMotor']
export const pcsx2Pad1 = () => PCSX2_PAD1
const pcsx2Controller = (H: string) => {
  // Rewritten while Cross is unbound, on the keyboard (PCSX2's first-start default), or on the old "A" name.
  const f = `${H}/.config/PCSX2/inis/PCSX2.ini`
  return `ini=${sq(f)}; c=$(iniget "$ini" Pad1 Cross); case "$c" in ""|Keyboard/*|SDL-0/A) mkdir -p "$(dirname "$ini")"; if [ -f "$ini" ]; then awk '/^\\[Pad1\\]/{s=1;next} /^\\[/{s=0} !s' "$ini" > "$ini.tmp" && mv "$ini.tmp" "$ini"; fi; printf '%s\\n' ${PCSX2_PAD1.map(sq).join(' ')} >> "$ini";; esac`
}

// ---------- The launch script's side ----------

export type ControllerId = 'pcsx2' | 'dolphin' | 'rpcs3' | 'cemu' | 'eden' | 'ryujinx'

/** The shell that maps the first pad for one emulator (run as the app's user, before it starts). */
export function controllerShell(id: ControllerId, H: string, p: VirtualPad): string {
  switch (id) {
    case 'pcsx2':
      return pcsx2Controller(H)
    case 'dolphin':
      return dolphinController(H, p)
    case 'rpcs3':
      return rpcs3Controller(H, p)
    case 'cemu':
      return cemuControllerShell(H, p)
    case 'eden':
      return edenController(H, p)
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
  `iniset() { local f=$1; mkdir -p "$(dirname "$f")"; [ -f "$f" ] || : > "$f"; S="$2" SEP="$3" KEEP="\${4:-}" awk -F '\\t' 'BEGIN{s="["ENVIRON["S"]"]"; sep=ENVIRON["SEP"]; keep=(ENVIRON["KEEP"]!="")} FNR==NR { if (NF>=2) { n++; key[n]=$1; val[$1]=substr($0,length($1)+2) } next } function flush(  i) { for (i=1;i<=n;i++) if (!(key[i] in seen)) print key[i] sep val[key[i]]; done=1 } { l=$0; sub(/\\r$/,"",l) } l ~ /^\\[.*\\]$/ { if (in_s && !done) flush(); in_s=(l==s); if (in_s) found=1; print; next } in_s { i=index(l,"="); if (i) { k=substr(l,1,i-1); gsub(/^[ \\t]+|[ \\t]+$/,"",k); if (k in val) { if (k in seen) next; seen[k]=1; if (!keep) { print k sep val[k]; next } } } } { print } END { if (in_s && !done) flush(); else if (!found) { print ""; print s; flush() } }' - "$f" > "$f.tmp" && mv "$f.tmp" "$f"; }`,
]
