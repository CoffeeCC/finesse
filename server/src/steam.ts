// Steam games as their own apps in Wolf: a shortcut is a copy of the Steam app
// that opens Steam straight into one game (games-on-whales' Steam image reads
// STEAM_STARTUP_FLAGS). It keeps the Steam app's runner name, so it shares that
// app's home folder: the same library, sign-in and saves. Finesse marks its
// shortcuts with FINESSE_STEAM_APPID in the runner's environment.
//
// Which games are installed comes from Steam's own manifests in that home
// folder on the host (Wolf keeps it at <state>/profile-data/<profile>/<runner>).
// Finesse reads them with a short-lived container of its own image that sees
// the folder read-only.

import { hostname } from 'node:os'
import { Docker } from './stack/docker.ts'

export interface SteamGame {
  appId: number
  name: string
  /** Bytes on disk (0 when Steam didn't say). */
  size: number
  /** When it was last played (Unix seconds; 0 when never or Steam didn't say). */
  lastPlayed: number
}

type RawApp = Record<string, unknown>
type Runner = { type?: unknown; name?: unknown; image?: unknown; env?: unknown }

export const APPID_ENV = 'FINESSE_STEAM_APPID'
const STEAM_IMAGE = /games-on-whales\/steam(:|@|$)/i

const runnerOf = (a: RawApp): Runner => (a.runner && typeof a.runner === 'object' ? (a.runner as Runner) : {})
const envOf = (a: RawApp): string[] => {
  const e = runnerOf(a).env
  return Array.isArray(e) ? e.filter((x): x is string => typeof x === 'string') : []
}

/** The game a shortcut opens (null for anything else). */
export function shortcutAppId(a: RawApp): number | null {
  const v = envOf(a).find((x) => x.startsWith(`${APPID_ENV}=`))
  const n = v ? Number(v.slice(APPID_ENV.length + 1)) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Wolf's own Steam app (games-on-whales' Steam image), not one of our shortcuts. */
export function isSteamApp(a: RawApp): boolean {
  const r = runnerOf(a)
  return r.type === 'docker' && typeof r.image === 'string' && STEAM_IMAGE.test(r.image) && typeof r.name === 'string' && shortcutAppId(a) === null
}

/** A Wolf app that opens Steam straight into one game; everything else is the Steam app's. */
export function steamShortcut(steam: RawApp, game: { appId: number; name: string }, gpuEnv: string[] = []): RawApp {
  const copy = JSON.parse(JSON.stringify(steam)) as RawApp
  copy.id = `finesse-steam-${game.appId}`
  copy.title = game.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || `Steam game ${game.appId}`
  const r = runnerOf(copy) as Record<string, unknown>
  r.env = [
    ...envOf(steam).filter((x) => !x.startsWith('STEAM_STARTUP_FLAGS=') && !x.startsWith(`${APPID_ENV}=`) && !(gpuEnv.length && x.startsWith('MESA_VK_DEVICE_SELECT'))),
    ...gpuEnv,
    // Big Picture first, so leaving the game lands somewhere a controller can use.
    `STEAM_STARTUP_FLAGS=-bigpicture steam://rungameid/${game.appId}`,
    `${APPID_ENV}=${game.appId}`,
  ]
  copy.runner = r
  return copy
}

// Steam's own tools show up as installed "games".
const TOOL_IDS = new Set([228980, 1070560, 1391110, 1628350, 1493710, 2180100, 1826330, 1887720, 2348590, 2805730, 3658110, 961940, 1113280, 1245040, 1420170, 1580130, 2230260, 250820])
const TOOL_NAME = /^(proton\b|steam linux runtime|steamworks common|steamvr|steam controller configs)/i

/** Steam's text format (VDF), just the "key" "value" pairs. */
export function vdfPairs(text: string): [string, string][] {
  const out: [string, string][] = []
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/g)) out.push([m[1]!.toLowerCase(), m[2]!.replace(/\\(.)/g, '$1')])
  return out
}

/** One appmanifest_<id>.acf: the game, when it's fully installed and not one of Steam's tools. */
export function parseManifest(text: string): SteamGame | null {
  const kv = new Map(vdfPairs(text))
  const appId = Number(kv.get('appid'))
  const name = kv.get('name') ?? ''
  const flags = Number(kv.get('stateflags') ?? '4')
  if (!Number.isInteger(appId) || appId <= 0 || !name) return null
  if (TOOL_IDS.has(appId) || TOOL_NAME.test(name)) return null
  // 4: fully installed (other bits: updating, validating; it still plays).
  if (!(flags & 4)) return null
  return { appId, name, size: Number(kv.get('sizeondisk')) || 0, lastPlayed: Number(kv.get('lastplayed')) || 0 }
}

// Runs inside the probe container: Steam's manifests in every library under /steam, as one JSON line.
// Library paths are written as Steam sees them (/home/retro/...), so they're mapped back under /steam.
const LIST_JS = `
const fs=require('fs'),path=require('path');
const roots=new Set(['/steam/.steam/steam/steamapps','/steam/.local/share/Steam/steamapps']);
for (const r of [...roots]) { try { const t=fs.readFileSync(path.join(r,'libraryfolders.vdf'),'utf8');
  for (const m of t.matchAll(/"path"\\s+"([^"]+)"/g)) { const p=m[1]; const home='/home/retro';
    if (p.startsWith(home+'/')) roots.add(path.join('/steam',p.slice(home.length+1),'steamapps')); } } catch {} }
const seen=new Set(), out=[];
for (const r of roots) { let names=[]; try { names=fs.readdirSync(r) } catch { continue }
  let real; try { real=fs.realpathSync(r) } catch { real=r } if (seen.has(real)) continue; seen.add(real);
  for (const n of names) if (/^appmanifest_\\d+\\.acf$/.test(n)) { try { out.push(fs.readFileSync(path.join(r,n),'utf8').slice(0,20000)) } catch {} } }
process.stdout.write(JSON.stringify(out)+'\\n');
`

/** Wolf's container (games-on-whales/wolf, or one named wolf). */
export async function findWolf(docker: Docker): Promise<{ Id: string; Names: string[] } | null> {
  const list = await docker.list({}, true)
  return list.find((c) => /games-on-whales\/wolf(:|@|$)/i.test(c.Image)) ?? list.find((c) => c.Names.some((n) => n.replace(/^\//, '') === 'wolf')) ?? null
}

/**
 * How much graphics memory Wolf holds, per card it uses (MiB), read with nvidia-smi inside its
 * container. Null without an Nvidia card there. Wolf has been seen to keep growing this until
 * streams fail with "out of memory"; a restart gives it back.
 */
export function parseWolfGpu(apps: string, gpus: string): { name: string; used: number; total: number; wolf: number }[] {
  const byGpu = new Map<string, number>()
  for (const line of apps.split('\n')) {
    const [uuid, name, mem] = line.split(',').map((x) => x.trim())
    if (uuid && name && /\bwolf\b/i.test(name) && Number(mem) >= 0) byGpu.set(uuid, (byGpu.get(uuid) ?? 0) + Number(mem))
  }
  const out: { name: string; used: number; total: number; wolf: number }[] = []
  for (const line of gpus.split('\n')) {
    const [uuid, name, used, total] = line.split(',').map((x) => x.trim())
    if (uuid && byGpu.has(uuid)) out.push({ name: name ?? 'GPU', used: Number(used) || 0, total: Number(total) || 0, wolf: byGpu.get(uuid)! })
  }
  return out
}

export async function wolfGpu(docker: Docker, container: string) {
  const q = (args: string) => docker.exec(container, ['sh', '-c', `nvidia-smi ${args} --format=csv,noheader,nounits 2>/dev/null`]).then((r) => r.output, () => '')
  const [apps, gpus] = await Promise.all([q('--query-compute-apps=gpu_uuid,process_name,used_memory'), q('--query-gpu=uuid,name,memory.used,memory.total')])
  return gpus.trim() ? parseWolfGpu(apps, gpus) : null
}

/** Where Wolf keeps its apps' home folders on the host (its HOST_APPS_STATE_FOLDER, by the Wolf container's own mount). */
export async function wolfStateFolder(docker: Docker): Promise<string | null> {
  if (process.env.FINESSE_WOLF_STATE) return process.env.FINESSE_WOLF_STATE.replace(/\/+$/, '')
  const wolf = await findWolf(docker)
  if (!wolf) return null
  const info = await docker.inspect(wolf.Id)
  if (!info) return null
  const inside = (info.Config.Env ?? []).find((e) => e.startsWith('HOST_APPS_STATE_FOLDER='))?.split('=')[1] || '/etc/wolf'
  const m = info.Mounts.find((x) => x.Destination.replace(/\/+$/, '') === inside.replace(/\/+$/, ''))
  return m ? m.Source.replace(/\/+$/, '') : null
}

/** The installed games in one Steam app's home folder (host path). */
export async function installedGames(docker: Docker, home: string): Promise<SteamGame[]> {
  const me = await docker.inspect(process.env.FINESSE_CONTAINER || hostname()).catch(() => null)
  const image = me?.Config.Image ?? process.env.FINESSE_IMAGE
  if (!image) throw new Error('Finesse can’t find its own image to look in the Steam folder with')
  const r = await docker.runOnce(image, ['node', '-e', LIST_JS], [`${home}:/steam:ro`])
  const line = r.output.split('\n').reverse().find((l) => l.startsWith('['))
  if (r.code !== 0 || !line) throw new Error(`Couldn’t read the Steam folder (${r.output.trim().slice(-200) || `exit ${r.code}`})`)
  const games = new Map<number, SteamGame>()
  for (const text of JSON.parse(line) as string[]) {
    const g = parseManifest(text)
    if (g) games.set(g.appId, g)
  }
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Emulators and their front ends: a row of their own, under the games.
const EMULATOR = /retroarch|emulationstation|es-de|pegasus|pcsx2|dolphin|rpcs3|cemu|yuzu|ryujinx|\beden\b|xemu|ppsspp|duckstation|melonds|azahar|citra|mame/i

/** What a Wolf app is, for the Games page's rows: a Steam game, an emulator, or another app. */
export function appKind(a: RawApp): 'steam' | 'emulator' | 'app' {
  if (shortcutAppId(a) !== null) return 'steam'
  const r = runnerOf(a)
  return EMULATOR.test(`${String(a.title ?? '')} ${String(r.image ?? '')}`) ? 'emulator' : 'app'
}

/** Steam's store artwork for a game: the tall cover, then the wide header. */
export const steamArtUrls = (appId: number) => [
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
]

/**
 * With more than one graphics card, a game can pick the one that can't show the stream's screen
 * (Vulkan: getSurfaceSupportKHR fails, the game closes at once). Mesa's device-select layer, which
 * also orders Nvidia's cards, pins it to the card the app renders on: these variables, or none
 * with one card. `cards` maps render nodes to their PCI "vendor:device".
 */
export function gpuPinEnv(renderNode: unknown, cards: Record<string, string>): string[] {
  const node = typeof renderNode === 'string' ? renderNode.split('/').pop()! : ''
  const id = cards[node]
  if (Object.keys(cards).length < 2 || !id) return []
  return [`MESA_VK_DEVICE_SELECT=${id}!`, 'MESA_VK_DEVICE_SELECT_FORCE_DEFAULT_DEVICE=1']
}

/** The host's render nodes and their PCI ids ("renderD128" → "10de:2504"), read with a one-off container of Finesse's image. */
export async function hostRenderCards(docker: Docker): Promise<Record<string, string>> {
  const me = await docker.inspect(process.env.FINESSE_CONTAINER || hostname()).catch(() => null)
  const image = me?.Config.Image ?? process.env.FINESSE_IMAGE
  if (!image) return {}
  const script = 'for d in /host/drm/renderD*; do [ -e "$d/device/vendor" ] && echo "$(basename $d) $(cat $d/device/vendor) $(cat $d/device/device)"; done; true'
  const r = await docker.runOnce(image, ['sh', '-c', script], ['/sys/class/drm:/host/drm:ro']).catch(() => null)
  const out: Record<string, string> = {}
  for (const line of (r?.output ?? '').split('\n')) {
    const m = /^(renderD\d+) 0x([0-9a-f]{4}) 0x([0-9a-f]{4})$/i.exec(line.trim())
    if (m) out[m[1]!] = `${m[2]!.toLowerCase()}:${m[3]!.toLowerCase()}`
  }
  return out
}
