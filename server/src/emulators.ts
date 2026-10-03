// Emulators as Wolf apps: PCSX2, Dolphin, RPCS3, Cemu, a Switch emulator
// (Ryujinx or Eden) and ES-DE, streamed to Moonlight like Steam.
//
// Finesse never touches the emulators, firmware, keys or games themselves. It
// hands Wolf folders by path (host paths, which Wolf gives to Docker), and it
// looks inside them by file name only, for the readiness check. Nothing here
// opens a file.
//
// Every app runs on Games on Whales' ES-DE image (Sway, controllers, audio and
// AppImage support), with the emulator's AppImage from the emulators folder.
// Saves are per Wolf profile (one per person in Wolf UI), read-write; ROMs,
// firmware and keys are mounted read-only.

import { accessSync, chmodSync, chownSync, constants, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EMULATOR_IMAGE } from './stack/catalog.ts'

export type EmulatorId = 'pcsx2' | 'dolphin' | 'rpcs3' | 'cemu' | 'switch' | 'esde'
export type SwitchEmulator = 'ryujinx' | 'eden'
export const EMULATOR_IDS: EmulatorId[] = ['pcsx2', 'dolphin', 'rpcs3', 'cemu', 'switch', 'esde']

/** Settings → Server → Game streaming → Emulators (and the setup document's `emulators`). */
export interface EmulatorSettings {
  /** The apps to add to Wolf. */
  apps: EmulatorId[]
  /** Which Switch emulator the "switch" app runs. */
  switchEmulator?: SwitchEmulator
  /** Host paths, as Wolf (Docker) sees them. Finesse looks at the same paths for the readiness check. */
  paths: {
    /** RomM's library folder (with roms/<console> inside), read-only. */
    roms?: string
    /** The emulators' AppImages, read-only. */
    emulators?: string
    /** Firmware/BIOS, one folder per emulator inside (pcsx2, rpcs3, switch…), read-only. */
    firmware?: string
    /** Keys, one folder per emulator inside (cemu, switch, rpcs3…), read-only. */
    keys?: string
    /** Saves, one folder per Wolf profile inside, read-write. */
    saves?: string
  }
  /** A different firmware or keys folder for one emulator. */
  folders?: Partial<Record<EmulatorId, { firmware?: string; keys?: string }>>
  /** Wolf profiles to add the apps to (ids). Leave out for every profile. */
  profiles?: string[]
}

interface Need {
  what: 'firmware' | 'keys'
  label: string
  /** File names that count (case-insensitive globs: * and ?). */
  match: string[]
  required: boolean
  /** What it's for, when it's missing. */
  why: string
}

interface Emulator {
  id: EmulatorId
  /** Wolf app title (also what Moonlight and Wolf UI show). */
  title: string
  name: string
  /** RomM console slugs it plays. */
  consoles: string[]
  /** The program in the emulators folder (case-insensitive globs). */
  program: string[]
  needs: Need[]
  /** Save folders inside the app's home, under <saves>/<profile>/<id>/<key>. */
  saves: Record<string, string>
  /** Links made at start: the files from /finesse/<what>/<id> matching `match`, into `into`. `copy` when the emulator writes to them (Eden opens its firmware read-write): copied once instead. */
  links: { what: 'firmware' | 'keys'; match: string[]; into: string; copy?: true }[]
  /** Arguments with a game ($GAME) and without one. */
  args: { game: string; none: string }
  /** Shell run before the emulator (inside the session). */
  before?: string
  /** Maps the first controller (Selkies' or Wolf's virtual pad; the touch controller too) unless the player mapped one themselves. */
  controller?: string
}

// PCSX2 Player 1 on the first SDL controller. Games on Whales' mapping, with PCSX2 2.x's names for the face
// buttons (FaceSouth…): its old A/B/X/Y are "invalid bindings" now, which left Cross, Circle, Square and Triangle dead.
const PCSX2_PAD1 = ['[Pad1]', 'Type = DualShock2', 'Up = SDL-0/DPadUp', 'Right = SDL-0/DPadRight', 'Down = SDL-0/DPadDown', 'Left = SDL-0/DPadLeft', 'Triangle = SDL-0/FaceNorth', 'Circle = SDL-0/FaceEast', 'Cross = SDL-0/FaceSouth', 'Square = SDL-0/FaceWest', 'Select = SDL-0/Back', 'Start = SDL-0/Start', 'L1 = SDL-0/LeftShoulder', 'L2 = SDL-0/+LeftTrigger', 'R1 = SDL-0/RightShoulder', 'R2 = SDL-0/+RightTrigger', 'L3 = SDL-0/LeftStick', 'R3 = SDL-0/RightStick', 'LUp = SDL-0/-LeftY', 'LRight = SDL-0/+LeftX', 'LDown = SDL-0/+LeftY', 'LLeft = SDL-0/-LeftX', 'RUp = SDL-0/-RightY', 'RRight = SDL-0/+RightX', 'RDown = SDL-0/+RightY', 'RLeft = SDL-0/-RightX', 'Analog = SDL-0/Guide', 'LargeMotor = SDL-0/LargeMotor', 'SmallMotor = SDL-0/SmallMotor']
const pcsx2Controller = (H: string) =>
  `ini=${H}/.config/PCSX2/inis/PCSX2.ini; if ! grep -q -E '= *(SDL-[0-9]+/FaceSouth|Keyboard/|XInput)' "$ini" 2>/dev/null || grep -q -E '^Cross = SDL-0/A$' "$ini"; then mkdir -p "$(dirname "$ini")"; if [ -f "$ini" ]; then awk '/^\\[Pad1\\]/{s=1;next} /^\\[/{s=0} !s' "$ini" > "$ini.tmp" && mv "$ini.tmp" "$ini"; fi; printf '%s\\n' ${PCSX2_PAD1.map((l) => `'${l}'`).join(' ')} >> "$ini"; fi`

/** The app's home folder: Wolf's apps (Games on Whales) use /home/retro; browser play (Selkies) uses /config. */
export const WOLF_HOME = '/home/retro'

const switchEmulators = (H: string): Record<SwitchEmulator, Omit<Emulator, 'id' | 'consoles' | 'title'>> => ({
  ryujinx: {
    name: 'Ryujinx',
    program: ['ryujinx*.appimage', 'ryujinx*/ryujinx', 'publish/ryujinx'],
    needs: [
      { what: 'keys', label: 'prod.keys', match: ['prod.keys'], required: true, why: 'Switch games don’t start without your console’s prod.keys.' },
      { what: 'keys', label: 'title.keys', match: ['title.keys'], required: false, why: 'Some games and updates need title.keys.' },
      { what: 'firmware', label: 'Switch firmware', match: ['*.nca', '*.zip'], required: true, why: 'Install it once in Ryujinx: Tools → Install Firmware → from /finesse/firmware/switch.' },
    ],
    saves: { save: `${H}/.config/Ryujinx/bis/user/save` },
    links: [{ what: 'keys', match: ['*.keys'], into: `${H}/.config/Ryujinx/system` }],
    args: { game: '--fullscreen "$GAME"', none: '' },
  },
  eden: {
    name: 'Eden',
    program: ['eden*.appimage'],
    needs: [
      { what: 'keys', label: 'prod.keys', match: ['prod.keys'], required: true, why: 'Switch games don’t start without your console’s prod.keys.' },
      { what: 'keys', label: 'title.keys', match: ['title.keys'], required: false, why: 'Some games and updates need title.keys.' },
      { what: 'firmware', label: 'Switch firmware (.nca files)', match: ['*.nca'], required: true, why: 'Eden reads the firmware’s .nca files; unzip the firmware into the switch folder.' },
    ],
    saves: { save: `${H}/.local/share/eden/nand/user/save` },
    links: [
      { what: 'keys', match: ['*.keys'], into: `${H}/.local/share/eden/keys` },
      { what: 'firmware', match: ['*.nca'], into: `${H}/.local/share/eden/nand/system/Contents/registered`, copy: true },
    ],
    args: { game: '-f -g "$GAME"', none: '' },
  },
})

/** The emulator apps, with the Switch app running the chosen Switch emulator. */
export function emulatorCatalog(switchEmulator: SwitchEmulator = 'ryujinx', H = WOLF_HOME): Record<EmulatorId, Emulator> {
  const sw = switchEmulators(H)[switchEmulator]
  const list: Emulator[] = [
    {
      id: 'pcsx2',
      title: 'PCSX2 (PS2)',
      name: 'PCSX2',
      consoles: ['ps2'],
      program: ['pcsx2*.appimage'],
      needs: [{ what: 'firmware', label: 'PS2 BIOS', match: ['*.bin', '*.rom0'], required: true, why: 'PS2 games don’t start without a BIOS dumped from your console.' }],
      saves: { memcards: `${H}/.config/PCSX2/memcards`, sstates: `${H}/.config/PCSX2/sstates` },
      links: [{ what: 'firmware', match: ['*'], into: `${H}/.config/PCSX2/bios` }],
      args: { game: '-fullscreen -nogui -- "$GAME"', none: '-bigpicture -fullscreen' },
      controller: pcsx2Controller(H),
    },
    {
      id: 'dolphin',
      title: 'Dolphin (GameCube & Wii)',
      name: 'Dolphin',
      consoles: ['ngc', 'gamecube', 'gc', 'wii'],
      program: ['dolphin*.appimage', 'dolphin*/dolphin-emu'],
      needs: [],
      saves: { GC: `${H}/.local/share/dolphin-emu/GC`, Wii: `${H}/.local/share/dolphin-emu/Wii` },
      links: [],
      args: { game: '-b -e "$GAME"', none: '' },
    },
    {
      id: 'rpcs3',
      title: 'RPCS3 (PS3)',
      name: 'RPCS3',
      consoles: ['ps3'],
      program: ['rpcs3*.appimage'],
      needs: [
        { what: 'firmware', label: 'PS3UPDAT.PUP', match: ['ps3updat.pup'], required: true, why: 'RPCS3 installs the PS3 firmware from it the first time it starts.' },
        { what: 'keys', label: 'Licences (.rap)', match: ['*.rap'], required: false, why: 'Only digital (PSN) games need their .rap licence files.' },
      ],
      saves: { savedata: `${H}/.config/rpcs3/dev_hdd0/home/00000001/savedata` },
      links: [{ what: 'keys', match: ['*.rap'], into: `${H}/.config/rpcs3/dev_hdd0/home/00000001/exdata` }],
      args: { game: '--no-gui "$GAME"', none: '' },
      before: `[ -e ${H}/.config/rpcs3/dev_flash/vsh/module/vsh.self ] || { pup=$(ls /finesse/firmware/rpcs3/[Pp][Ss]3[Uu][Pp][Dd][Aa][Tt].[Pp][Uu][Pp] 2>/dev/null | head -n1); [ -z "$pup" ] || "$BIN" --installfw "$pup" || true; }`,
    },
    {
      id: 'cemu',
      title: 'Cemu (Wii U)',
      name: 'Cemu',
      consoles: ['wiiu'],
      program: ['cemu*.appimage'],
      needs: [
        { what: 'keys', label: 'keys.txt', match: ['keys.txt'], required: true, why: 'Encrypted disc images (.wud, .wux) need your keys.txt. Decrypted games play without it.' },
        { what: 'firmware', label: 'Online files (otp.bin, seeprom.bin)', match: ['otp.bin', 'seeprom.bin'], required: false, why: 'Only for online play.' },
      ],
      saves: { save: `${H}/.local/share/Cemu/mlc01/usr/save` },
      links: [
        { what: 'keys', match: ['keys.txt'], into: `${H}/.local/share/Cemu` },
        { what: 'firmware', match: ['otp.bin', 'seeprom.bin'], into: `${H}/.local/share/Cemu` },
      ],
      args: { game: '-f -g "$GAME"', none: '' },
    },
    { id: 'switch', title: `${sw.name} (Switch)`, consoles: ['switch'], ...sw },
    {
      id: 'esde',
      title: 'ES-DE (all your games)',
      name: 'ES-DE',
      consoles: [],
      program: [],
      needs: [],
      saves: {},
      links: [],
      args: { game: '', none: '' },
    },
  ]
  return Object.fromEntries(list.map((e) => [e.id, e])) as Record<EmulatorId, Emulator>
}

// ---------- Validation ----------

export interface Problem {
  path: string
  message: string
}

/** A host path Wolf can hand to Docker as a bind mount ("src:dst:ro"). */
export const HOST_PATH = /^\/(?!.*(?:^|\/)\.\.(?:\/|$))[^:,\n\r"'`$\\]{0,4095}$/
const PROFILE_ID = /^[\w.@-]{1,64}$/

export function validateEmulators(v: unknown, at = 'emulators'): Problem[] {
  const p: Problem[] = []
  const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x)
  const known = (x: unknown, where: string, keys: string[]) => {
    if (x === undefined) return
    if (!isObj(x)) return void p.push({ path: where, message: 'Must be an object' })
    for (const k of Object.keys(x)) if (!keys.includes(k)) p.push({ path: `${where}.${k}`, message: `Unknown setting "${k}" — expected one of: ${keys.join(', ')}` })
  }
  const path = (x: unknown, where: string) => {
    if (x === undefined) return
    if (typeof x !== 'string' || !HOST_PATH.test(x)) p.push({ path: where, message: 'Use a full folder path on the server, like /mnt/tank/games/bios (no : , quotes or ..)' })
  }
  if (!isObj(v)) return [{ path: at, message: 'Must be an object' }]
  known(v, at, ['apps', 'switchEmulator', 'paths', 'folders', 'profiles'])
  if (!Array.isArray(v.apps) || !v.apps.every((a) => EMULATOR_IDS.includes(a as EmulatorId))) p.push({ path: `${at}.apps`, message: `A list of apps: ${EMULATOR_IDS.join(', ')}` })
  if (v.switchEmulator !== undefined && v.switchEmulator !== 'ryujinx' && v.switchEmulator !== 'eden') p.push({ path: `${at}.switchEmulator`, message: 'The Switch emulator is ryujinx or eden' })
  if (!isObj(v.paths)) p.push({ path: `${at}.paths`, message: 'Say where the folders are: roms, emulators, firmware, keys and saves' })
  else {
    known(v.paths, `${at}.paths`, ['roms', 'emulators', 'firmware', 'keys', 'saves'])
    for (const k of ['roms', 'emulators', 'firmware', 'keys', 'saves']) path(v.paths[k], `${at}.paths.${k}`)
    const apps = Array.isArray(v.apps) ? v.apps : []
    if (apps.length && !v.paths.roms) p.push({ path: `${at}.paths.roms`, message: 'Say where RomM’s library is (the folder with roms inside)' })
    if (apps.length && !v.paths.saves) p.push({ path: `${at}.paths.saves`, message: 'Say where saves go (a folder Wolf’s apps can write to)' })
    if (apps.some((a) => a !== 'esde') && !v.paths.emulators) p.push({ path: `${at}.paths.emulators`, message: 'Say where the emulators’ AppImages are' })
  }
  if (v.folders !== undefined) {
    known(v.folders, `${at}.folders`, EMULATOR_IDS)
    if (isObj(v.folders))
      for (const [id, f] of Object.entries(v.folders)) {
        known(f, `${at}.folders.${id}`, ['firmware', 'keys'])
        if (isObj(f)) for (const k of ['firmware', 'keys']) path(f[k], `${at}.folders.${id}.${k}`)
      }
  }
  if (v.profiles !== undefined && (!Array.isArray(v.profiles) || !v.profiles.every((x) => typeof x === 'string' && PROFILE_ID.test(x))))
    p.push({ path: `${at}.profiles`, message: 'A list of Wolf profile ids, like ["user"]' })
  return p
}

/** A folder for one emulator: its own setting, else <root>/<emulator>. */
export function folderFor(s: EmulatorSettings, id: EmulatorId, what: 'firmware' | 'keys'): string | undefined {
  const own = s.folders?.[id]?.[what]
  if (own) return own
  const root = s.paths[what]
  return root ? `${root.replace(/\/+$/, '')}/${id}` : undefined
}

/** A profile id as a folder name. */
export const profileFolder = (id: string) => id.replace(/[^\w.@-]/g, '_') || 'profile'

// ---------- Wolf apps ----------

/** What Wolf needs to know about an app beyond the runner; copied from an app it already has. */
export interface WolfAppBase {
  h264_gst_pipeline: string
  hevc_gst_pipeline: string
  av1_gst_pipeline: string
  render_node: string
  opus_gst_pipeline: string
}

export interface WolfApp extends WolfAppBase {
  title: string
  id: string
  support_hdr: boolean
  icon_png_path?: string
  start_virtual_compositor: boolean
  start_audio_server: boolean
  runner: { type: 'docker'; name: string; image: string; mounts: string[]; env: string[]; devices: string[]; ports: string[]; base_create_json: string } | Record<string, unknown>
}

const RUNNER_PREFIX = 'Finesse-'
/** One of ours: Finesse names its runners Finesse-<emulator>. */
export const isOurApp = (a: { runner?: unknown }) => {
  const r = a.runner as { type?: unknown; name?: unknown } | undefined
  return r?.type === 'docker' && typeof r.name === 'string' && r.name.startsWith(RUNNER_PREFIX)
}
/** Which emulator one of our apps runs. */
export const emulatorOf = (a: { runner?: unknown }): EmulatorId | null => {
  if (!isOurApp(a)) return null
  const id = String((a.runner as { name: string }).name).slice(RUNNER_PREFIX.length).split('-')[0]!.toLowerCase()
  return EMULATOR_IDS.includes(id as EmulatorId) ? (id as EmulatorId) : null
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// RomM's console folders → ES-DE's system names, where they differ.
const ESDE_NAMES: Record<string, string> = { ngc: 'gc', gamecube: 'gc', sms: 'mastersystem', sega32: 'sega32x', gg: 'gamegear', tg16: 'tg16', 'turbografx-cd': 'tg-cd', ps: 'psx' }

/** The links one emulator needs in the home folder, as shell. */
function linkLines(e: Emulator): string[] {
  return e.links.map((l) => `${l.copy ? 'copyin' : 'link'} /finesse/${l.what}/${e.id} ${q(l.into)} ${l.match.map((m) => q(m)).join(' ')}`)
}

/** The start script: runs as the app's user, inside Wolf's session. */
export function launchScript(e: Emulator, all: Emulator[], opts: { home?: string; browser?: boolean } = {}): string {
  const H = opts.home ?? WOLF_HOME
  const lines = [
    'set -e',
    // Wolf: Games on Whales' helpers start the app in Sway. Browser play: the desktop is already there.
    // Browser play keeps its own log (Finesse shows it to administrators when a game won't start).
    ...(opts.browser
      ? [`exec >>${H}/finesse-play.log 2>&1`, 'echo "--- $(date)"', 'gow_log() { echo "$*"; }', 'launcher() { exec "$@"; }']
      : ['source /opt/gow/bash-lib/utils.sh', 'source /opt/gow/launch-comp.sh']),
    'shopt -s nullglob nocaseglob',
    // Files from a read-only folder, linked by name into where the emulator looks.
    'link() { local src=$1 dst=$2; shift 2; [ -d "$src" ] || return 0; mkdir -p "$dst"; for p in "$@"; do for f in "$src"/$p; do [ -f "$f" ] && ln -sfn "$f" "$dst/"; done; done; return 0; }',
    // Copied once (and again only when the file changes), for files the emulator opens read-write.
    'copyin() { local src=$1 dst=$2; shift 2; [ -d "$src" ] || return 0; mkdir -p "$dst"; for p in "$@"; do for f in "$src"/$p; do [ -f "$f" ] || continue; t="$dst/$(basename "$f")"; [ -L "$t" ] && rm -f "$t"; [ -f "$t" ] && [ "$(stat -c %s "$t")" = "$(stat -c %s "$f")" ] || cp -f "$f" "$t"; done; done; return 0; }',
    'find_emu() { for p in "$@"; do for f in /finesse/emulators/$p; do [ -f "$f" ] && { echo "$f"; return 0; }; done; done; return 0; }',
    // AppImages without their executable bit (a NAS share) run from a copy.
    'runnable() { if [ -x "$1" ]; then echo "$1"; else cp "$1" "/tmp/$(basename "$1")" && chmod +x "/tmp/$(basename "$1")" && echo "/tmp/$(basename "$1")"; fi; }',
  ]
  if (e.id === 'esde') {
    // ES-DE finds emulators in ~/Applications, and shares their links and saves.
    lines.push(`mkdir -p ${H}/Applications`, `for f in /finesse/emulators/*; do ln -sfn "$f" ${H}/Applications/; done`)
    for (const o of all) if (o.id !== 'esde') lines.push(...linkLines(o))
    lines.push(`printf '#!/bin/bash\\nexec /Applications/esde.AppImage --appimage-extract-and-run --no-update-check\\n' > /tmp/finesse-run.sh`)
  } else {
    lines.push(...linkLines(e))
    if (e.controller) lines.push(e.controller)
    lines.push(
      `BIN=$(find_emu ${e.program.map(q).join(' ')})`,
      `[ -n "$BIN" ] || { gow_log ${q(`${e.name} isn’t in the emulators folder`)}; exit 1; }`,
      'BIN=$(runnable "$BIN")',
      // A wrapper, so a game's name with spaces survives Sway's exec line.
      `{ echo '#!/bin/bash'; printf 'BIN=%q\\nGAME=%q\\n' "$BIN" "\${FINESSE_GAME:-}"; ${e.before ? `echo ${q(e.before)}; ` : ''}echo 'if [ -n "$GAME" ]; then exec "$BIN" ${e.args.game.replace(/'/g, `'"'"'`)}; else exec "$BIN" ${e.args.none}; fi'; } > /tmp/finesse-run.sh`,
    )
  }
  lines.push('chmod +x /tmp/finesse-run.sh', `gow_log ${q(`Finesse: starting ${e.name}`)}`, 'launcher /tmp/finesse-run.sh')
  return lines.join('\n')
}

/** Docker makes the save folders' parents as root; the app's user needs to add folders beside them. Stays on the home folder's own disk (-xdev), so mounted folders are left alone. */
export const ownHome = (home: string, user: string) => `find ${home} -xdev -type d -user root -exec chown ${user}:${user} {} + 2>/dev/null || true`

/**
 * Nvidia's Vulkan driver, where emulators' AppImages look for it. They bundle their own Vulkan
 * loader and only read /usr/share/vulkan/icd.d; without the file there they fall back to
 * software rendering (slow motion). Root only; harmless where the file already is.
 */
export const NVIDIA_ICD = `if [ -e /dev/nvidiactl ] && [ ! -f /usr/share/vulkan/icd.d/nvidia_icd.json ]; then mkdir -p /usr/share/vulkan/icd.d; f=$(ls /etc/vulkan/icd.d/nvidia_icd*.json /usr/share/vulkan/icd.d/nvidia*.json 2>/dev/null | head -n1); if [ -n "$f" ]; then cp "$f" /usr/share/vulkan/icd.d/nvidia_icd.json; else printf '%s' '{"file_format_version":"1.0.0","ICD":{"library_path":"libGLX_nvidia.so.0","api_version":"1.3.0"}}' > /usr/share/vulkan/icd.d/nvidia_icd.json; fi; fi`

/** Runs as root before the app's user takes over: the home folder's ownership, Nvidia's Vulkan driver file, and ES-DE's /ROMs, made from RomM's folders. */
function rootPrep(e: Emulator): string {
  const own = `${ownHome(WOLF_HOME, '"${UNAME:-retro}"')}\n${NVIDIA_ICD}`
  if (e.id !== 'esde') return own
  const map = Object.entries(ESDE_NAMES)
    .map(([k, v]) => `${k}) n=${v};;`)
    .join(' ')
  return [
    own,
    'shopt -s nullglob; mkdir -p /ROMs',
    // RomM keeps roms/<console> (or <console>/roms).
    `for d in /finesse/roms/roms/*/ /finesse/roms/*/roms/; do s=$(basename "\${d%/roms/}"); [ "$s" = roms ] && s=$(basename "$d"); n=$s; case "$s" in ${map} esac; [ -e "/ROMs/$n" ] || ln -s "\${d%/}" "/ROMs/$n"; done`,
  ].join('\n')
}

export interface AppContext {
  settings: EmulatorSettings
  /** The Wolf profile the app belongs to (saves go in its folder). */
  profile: string
  base: WolfAppBase
  /** A game to start, as a path inside the app (/finesse/roms/…). */
  game?: string
}

/** The folders one emulator app gets: games, emulators, its firmware and keys (read-only), the profile's saves (read-write). */
export function appMounts(id: EmulatorId, s: EmulatorSettings, profile: string, home = WOLF_HOME): string[] {
  const cat = emulatorCatalog(s.switchEmulator, home)
  const e = cat[id]
  const all = Object.values(cat).filter((o) => s.apps.includes(o.id) || id === 'esde')
  const mounts: string[] = []
  if (s.paths.roms) mounts.push(`${s.paths.roms}:/finesse/roms:ro`)
  if (s.paths.emulators) mounts.push(`${s.paths.emulators}:/finesse/emulators:ro`)
  const users = id === 'esde' ? all.filter((o) => o.id !== 'esde') : [e]
  for (const o of users) {
    for (const what of ['firmware', 'keys'] as const) {
      const dir = folderFor(s, o.id, what)
      if (dir && (o.needs.some((n) => n.what === what) || o.links.some((l) => l.what === what))) mounts.push(`${dir}:/finesse/${what}/${o.id}:ro`)
    }
    if (s.paths.saves) for (const [k, inside] of Object.entries(o.saves)) mounts.push(`${savesDir(s, profile, o.id, k)}:${inside}:rw`)
  }
  return mounts
}

/** One emulator as a Wolf app. */
export function wolfApp(id: EmulatorId, ctx: AppContext): WolfApp {
  const s = ctx.settings
  const cat = emulatorCatalog(s.switchEmulator)
  const e = cat[id]
  const all = Object.values(cat).filter((o) => s.apps.includes(o.id) || id === 'esde')
  const mounts = appMounts(id, s, ctx.profile)
  const env = [
    'RUN_SWAY=1',
    'GOW_REQUIRED_DEVICES=/dev/input/* /dev/dri/* /dev/nvidia*',
    `FINESSE_LAUNCH=${launchScript(e, all)}`,
    ...(ctx.game ? [`FINESSE_GAME=${ctx.game}`] : []),
    `FINESSE_PREP=${rootPrep(e)}`,
  ]
  const create = {
    HostConfig: { IpcMode: 'host', Privileged: false, CapAdd: ['NET_RAW', 'MKNOD', 'NET_ADMIN'], DeviceCgroupRules: ['c 13:* rmw', 'c 244:* rmw'] },
    // GoW's entrypoint runs a given command as root after its setup; hand over to the app's user.
    Cmd: ['bash -c "${FINESSE_PREP:-true}"; exec gosu "${UNAME}" bash -c "$FINESSE_LAUNCH"'],
  }
  return {
    title: e.title,
    id: `finesse-${id}`,
    support_hdr: false,
    ...(id === 'esde' ? { icon_png_path: 'https://games-on-whales.github.io/wildlife/apps/es-de/assets/icon.png' } : {}),
    ...ctx.base,
    start_virtual_compositor: true,
    start_audio_server: true,
    runner: { type: 'docker', name: `${RUNNER_PREFIX}${id}`, image: EMULATOR_IMAGE, mounts, env, devices: [], ports: [], base_create_json: JSON.stringify(create) },
  }
}

export const savesDir = (s: EmulatorSettings, profile: string, id: EmulatorId, key: string) => `${s.paths.saves!.replace(/\/+$/, '')}/${profileFolder(profile)}/${id}/${key}`

// ---------- Readiness (file names only) ----------

export interface ReadyItem {
  label: string
  /** found, missing, or Finesse can't see the folder. */
  state: 'ok' | 'missing' | 'unseen'
  required: boolean
  detail: string
}

export interface EmulatorReadiness {
  id: EmulatorId
  title: string
  name: string
  consoles: string[]
  ready: boolean
  items: ReadyItem[]
}

const glob = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')

/** File names in a folder (one level), or null when Finesse can't see it. */
function names(dir: string | undefined): string[] | null {
  if (!dir) return null
  try {
    return readdirSync(dir)
  } catch {
    return null
  }
}

/** A program path (pattern with at most one folder level) found by name. */
function findProgram(dir: string | undefined, patterns: string[]): { path: string; exec: boolean } | null | undefined {
  const top = names(dir)
  if (!top || !dir) return undefined
  for (const p of patterns) {
    const [first, second] = p.split('/') as [string, string | undefined]
    for (const n of top.filter((x) => glob(first).test(x))) {
      const path = second ? (names(join(dir, n)) ?? []).filter((x) => glob(second).test(x)).map((x) => join(dir, n, x))[0] : join(dir, n)
      if (!path) continue
      try {
        const st = statSync(path)
        if (st.isFile()) return { path, exec: (st.mode & 0o111) !== 0 }
      } catch {
        /* gone */
      }
    }
  }
  return null
}

export function readiness(s: EmulatorSettings): EmulatorReadiness[] {
  const cat = emulatorCatalog(s.switchEmulator)
  const unseen = (dir: string | undefined, what: string): ReadyItem => ({
    label: what,
    state: 'unseen',
    required: true,
    detail: dir ? `Finesse can’t see ${dir}. Share it with Finesse read-only, at the same path.` : `Set the ${what.toLowerCase()} folder first.`,
  })
  const common: ReadyItem[] = []
  const roms = names(s.paths.roms)
  if (!roms) common.push(unseen(s.paths.roms, 'Games (RomM)'))
  const saves = s.paths.saves
  let savesOk = false
  try {
    if (saves) accessSync(saves, constants.W_OK)
    savesOk = Boolean(saves)
  } catch {
    /* below */
  }
  // RomM keeps roms/<console>; some libraries use <console>/roms.
  const romDirs = new Set<string>([...(names(s.paths.roms && join(s.paths.roms, 'roms')) ?? []), ...(roms ?? []).filter((d) => (names(s.paths.roms && join(s.paths.roms, d, 'roms')) ?? null) !== null)].map((d) => d.toLowerCase()))

  return s.apps.map((id) => {
    const e = cat[id]
    const items: ReadyItem[] = [...common]
    if (id !== 'esde') {
      const prog = findProgram(s.paths.emulators, e.program)
      if (prog === undefined) items.push(unseen(s.paths.emulators, 'Emulators'))
      else
        items.push(
          prog
            ? { label: e.name, state: 'ok', required: true, detail: prog.exec ? 'Found in the emulators folder.' : 'Found. It isn’t marked executable, so it starts from a copy (a bit slower). chmod +x fixes that.' }
            : { label: e.name, state: 'missing', required: true, detail: `Put the ${e.name} AppImage in the emulators folder (its name starts with “${e.program[0]!.split('*')[0]}”).` },
        )
    } else {
      const missing = s.apps.filter((a) => a !== 'esde' && findProgram(s.paths.emulators, cat[a].program) === null)
      items.push({ label: 'Emulators', state: 'ok', required: false, detail: missing.length ? `ES-DE uses the same emulators. Missing: ${missing.map((a) => cat[a].name).join(', ')}.` : 'ES-DE uses the emulators above, and any other AppImage in the emulators folder (RetroArch for older consoles).' })
    }
    for (const n of e.needs) {
      const dir = folderFor(s, id, n.what)
      const list = names(dir)
      if (!list) {
        items.push({ ...unseen(dir, n.what === 'firmware' ? 'Firmware' : 'Keys'), label: n.label, required: n.required, detail: dir ? `Finesse can’t see ${dir}. ${n.required ? 'Add it there, and share' : 'Share'} the folder with Finesse read-only, at the same path.` : `Set the ${n.what} folder first.` })
        continue
      }
      const found = list.some((f) => n.match.some((m) => glob(m).test(f)))
      items.push({ label: n.label, state: found ? 'ok' : 'missing', required: n.required, detail: found ? `In ${n.what === 'firmware' ? 'the firmware' : 'the keys'} folder.` : `${n.why} Put it in ${dir}.` })
    }
    if (e.consoles.length) {
      const has = e.consoles.filter((c) => romDirs.has(c))
      if (roms) items.push({ label: 'Games', state: has.length ? 'ok' : 'missing', required: false, detail: has.length ? `RomM’s ${has.join(', ')} folder.` : `No ${e.consoles.join(' or ')} folder in RomM’s library yet.` })
    }
    items.push(
      savesOk
        ? { label: 'Saves', state: 'ok', required: true, detail: 'Each Wolf profile gets its own saves folder.' }
        : saves
          ? { label: 'Saves', state: 'unseen', required: true, detail: `Finesse can’t write to ${saves}. Share it with Finesse at the same path, so it can make each profile’s folder.` }
          : { label: 'Saves', state: 'missing', required: true, detail: 'Set the saves folder.' },
    )
    return { id, title: e.title, name: e.name, consoles: e.consoles, ready: items.every((i) => i.state === 'ok' || !i.required), items }
  })
}

/** Makes a profile's save folders, owned by the apps' user, when Finesse can see the saves folder. */
export function ensureSaveFolders(s: EmulatorSettings, profile: string, owner: { uid: number; gid: number }): boolean {
  if (!s.paths.saves) return false
  try {
    accessSync(s.paths.saves, constants.W_OK)
  } catch {
    return false
  }
  const cat = emulatorCatalog(s.switchEmulator)
  for (const id of s.apps)
    for (const key of Object.keys(cat[id].saves)) {
      const dir = savesDir(s, profile, id, key)
      mkdirSync(dir, { recursive: true })
      for (const d of [dir, join(dir, '..'), join(dir, '..', '..')])
        try {
          chownSync(d, owner.uid, owner.gid)
        } catch {
          // Not root, or the share doesn't allow it: let the apps' user write anyway.
          try {
            chmodSync(d, 0o777)
          } catch {
            /* the share decides */
          }
        }
    }
  return true
}

/** The emulator that plays a RomM console, if it's one of the apps. */
export function emulatorForConsole(s: EmulatorSettings, slug: string): EmulatorId | null {
  const cat = emulatorCatalog(s.switchEmulator)
  return s.apps.find((id) => cat[id].consoles.includes(slug.toLowerCase())) ?? null
}
