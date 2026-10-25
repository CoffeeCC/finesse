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
export function steamShortcut(steam: RawApp, game: { appId: number; name: string }): RawApp {
  const copy = JSON.parse(JSON.stringify(steam)) as RawApp
  copy.id = `finesse-steam-${game.appId}`
  copy.title = game.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || `Steam game ${game.appId}`
  const r = runnerOf(copy) as Record<string, unknown>
  r.env = [
    ...envOf(steam).filter((x) => !x.startsWith('STEAM_STARTUP_FLAGS=') && !x.startsWith(`${APPID_ENV}=`)),
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
  return { appId, name, size: Number(kv.get('sizeondisk')) || 0 }
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

/** Where Wolf keeps its apps' home folders on the host (its HOST_APPS_STATE_FOLDER, by the Wolf container's own mount). */
export async function wolfStateFolder(docker: Docker): Promise<string | null> {
  if (process.env.FINESSE_WOLF_STATE) return process.env.FINESSE_WOLF_STATE.replace(/\/+$/, '')
  const list = await docker.list({}, true)
  const wolf = list.find((c) => /games-on-whales\/wolf(:|@|$)/i.test(c.Image)) ?? list.find((c) => c.Names.some((n) => n.replace(/^\//, '') === 'wolf'))
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

/** Steam's store artwork for a game: the tall cover, then the wide header. */
export const steamArtUrls = (appId: number) => [
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
]
