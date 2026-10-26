// Lutris games as their own Wolf apps, like Steam shortcuts (steam.ts): a copy
// of Wolf's Lutris app that opens one game. games-on-whales' Lutris image runs
// `lutris $LUTRIS_ARGS` when its gamepad front end is off
// (WOLF_LUTRIS_GAMEPAD_UI_ENABLE=0), and `lutris:rungameid/<id>` starts a game.
// The copy keeps the Lutris app's runner name, so it shares that app's home
// folder: the same library, wine prefixes and saves. Finesse marks its
// shortcuts with FINESSE_LUTRIS_ID.
//
// Which games are installed comes from Lutris's own database (pga.db) in that
// home folder, read with a short-lived container of Finesse's image (Node's
// built-in SQLite), the folder mounted read-only.

import { hostname } from 'node:os'
import type { Docker } from './stack/docker.ts'

export interface LutrisGame {
  id: number
  name: string
  slug: string
  /** Unix seconds; 0 when never played. */
  lastPlayed: number
  /** Hours Lutris counted. */
  playtime: number
}

type RawApp = Record<string, unknown>
type Runner = { type?: unknown; name?: unknown; image?: unknown; env?: unknown }

export const LUTRIS_ENV = 'FINESSE_LUTRIS_ID'
const LUTRIS_IMAGE = /games-on-whales\/lutris(:|@|$)/i

const runnerOf = (a: RawApp): Runner => (a.runner && typeof a.runner === 'object' ? (a.runner as Runner) : {})
const envOf = (a: RawApp): string[] => {
  const e = runnerOf(a).env
  return Array.isArray(e) ? e.filter((x): x is string => typeof x === 'string') : []
}

/** The Lutris game a shortcut opens (null for anything else). */
export function lutrisShortcutId(a: RawApp): number | null {
  const v = envOf(a).find((x) => x.startsWith(`${LUTRIS_ENV}=`))
  const n = v ? Number(v.slice(LUTRIS_ENV.length + 1)) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Wolf's own Lutris app, not one of our shortcuts. */
export function isLutrisApp(a: RawApp): boolean {
  const r = runnerOf(a)
  return r.type === 'docker' && typeof r.image === 'string' && LUTRIS_IMAGE.test(r.image) && typeof r.name === 'string' && lutrisShortcutId(a) === null
}

const OURS = /^(WOLF_LUTRIS_GAMEPAD_UI_ENABLE|LUTRIS_ARGS|FINESSE_LUTRIS_ID)=/

/** A Wolf app that opens Lutris straight into one game. */
export function lutrisShortcut(lutris: RawApp, game: { id: number; name: string }): RawApp {
  const copy = JSON.parse(JSON.stringify(lutris)) as RawApp
  copy.id = `finesse-lutris-${game.id}`
  copy.title = game.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || `Lutris game ${game.id}`
  const r = runnerOf(copy) as Record<string, unknown>
  r.env = [...envOf(lutris).filter((x) => !OURS.test(x)), 'WOLF_LUTRIS_GAMEPAD_UI_ENABLE=0', `LUTRIS_ARGS=lutris:rungameid/${game.id}`, `${LUTRIS_ENV}=${game.id}`]
  copy.runner = r
  return copy
}

// Runs inside the probe container: the installed games in Lutris's database, as one JSON line.
// Copied first: the folder is read-only and SQLite may want its journal beside the file.
export const LUTRIS_LIST_JS = `
const fs=require('fs');
const src=['/lutris/.local/share/lutris/pga.db','/lutris/.config/lutris/pga.db'].find((p)=>fs.existsSync(p));
if(!src){process.stdout.write('[]\\n');process.exit(0)}
fs.copyFileSync(src,'/tmp/pga.db');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/tmp/pga.db');
const cols=new Set(db.prepare("select name from pragma_table_info('games')").all().map((c)=>c.name));
const pick=(c,d)=>cols.has(c)?c:d+' as '+c;
const rows=db.prepare('select id,name,'+pick('slug',"''")+','+pick('lastplayed','0')+','+pick('playtime','0')+','+pick('installed','1')+','+pick('hidden','0')+' from games').all();
process.stdout.write(JSON.stringify(rows)+'\\n');
`

/** Rows from pga.db: installed, not hidden in Lutris, with a name. */
export function parseLutrisRows(rows: unknown[]): LutrisGame[] {
  const out: LutrisGame[] = []
  for (const r of rows as Record<string, unknown>[]) {
    const id = Number(r.id)
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (!Number.isInteger(id) || id <= 0 || !name || Number(r.installed) !== 1 || Number(r.hidden) === 1) continue
    out.push({ id, name, slug: typeof r.slug === 'string' ? r.slug : '', lastPlayed: Number(r.lastplayed) || 0, playtime: Number(r.playtime) || 0 })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The installed games in one Lutris app's home folder (host path). */
export async function installedLutrisGames(docker: Docker, home: string): Promise<LutrisGame[]> {
  const me = await docker.inspect(process.env.FINESSE_CONTAINER || hostname()).catch(() => null)
  const image = me?.Config.Image ?? process.env.FINESSE_IMAGE
  if (!image) throw new Error('Finesse can’t find its own image to look in the Lutris folder with')
  const r = await docker.runOnce(image, ['node', '--disable-warning=ExperimentalWarning', '-e', LUTRIS_LIST_JS], [`${home}:/lutris:ro`])
  const line = r.output.split('\n').reverse().find((l) => l.startsWith('['))
  if (r.code !== 0 || !line) throw new Error(`Couldn’t read Lutris’s games (${r.output.trim().slice(-200) || `exit ${r.code}`})`)
  return parseLutrisRows(JSON.parse(line) as unknown[])
}
