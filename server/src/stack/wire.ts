// Wires the stack together through each app's own API. Every step reads what
// is there first and only adds/changes what's missing, so re-running setup
// repairs drift instead of duplicating things. Field names come from the apps'
// live schemas (…/schema endpoints), not hard-coded payloads, so version bumps
// don't silently break the wiring.

import { logger } from '../log.ts'

const log = logger('wire')

export class WireError extends Error {}

async function http<T = unknown>(method: string, url: string, opts: { headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; timeoutMs?: number; okStatuses?: number[] } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
  let body: string | undefined
  if (opts.form) {
    body = new URLSearchParams(opts.form).toString()
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['Content-Type'] = 'application/json'
  }
  // Apps answer 503 while they finish starting (Jellyfin serves its "starting
  // up" page even after /System/Info/Public works): wait that out.
  const until = Date.now() + 180000
  let res: Response
  let text: string
  for (;;) {
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 30000), redirect: 'follow' })
    } catch (e) {
      throw new WireError(`${method} ${new URL(url).host}${new URL(url).pathname}: ${(e as Error).message}`)
    }
    text = await res.text()
    if (res.status !== 503 || Date.now() > until) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (!res.ok && !(opts.okStatuses ?? []).includes(res.status)) {
    let msg = /^\s*</.test(text) ? 'it answered with a web page instead (still starting?)' : text
    try {
      const j = JSON.parse(text)
      msg = Array.isArray(j) ? j.map((x: { errorMessage?: string; message?: string }) => x.errorMessage ?? x.message ?? JSON.stringify(x)).join('; ') : (j.message ?? j.error ?? text)
    } catch {
      /* text */
    }
    throw new WireError(`${method} ${new URL(url).pathname} → ${res.status}: ${String(msg).slice(0, 300)}`)
  }
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as T
  }
}

// ---------------------------------------------------------------------------
// Jellyfin
// ---------------------------------------------------------------------------

const JF_CLIENT = 'MediaBrowser Client="Finesse", Device="finesse-server", DeviceId="finesse-server", Version="1.0.0"'
const jfAuth = (token?: string) => ({ Authorization: token ? `${JF_CLIENT}, Token="${token}"` : JF_CLIENT })

export interface JellyfinSetup {
  /** http://jellyfin:8096 (no base path) */
  url: string
  admin: { username: string; password: string }
  serverName: string
  language: string
  country: string
  libraries: { movies: boolean; shows: boolean; music: boolean }
  /** Known API key from a previous run (lets re-runs work without the admin password). */
  apiKey?: string
  /** Restarts Jellyfin (needed when its BaseUrl changes). */
  restart?: () => Promise<void>
}

/** Detects which path Jellyfin currently answers under ('' or '/jellyfin'),
 *  waiting out its "starting up" phase (503). */
async function jfBase(url: string, waitMs = 120000, only?: string): Promise<string> {
  const until = Date.now() + waitMs
  do {
    for (const base of only !== undefined ? [only] : ['/jellyfin', '']) {
      try {
        const r = await fetch(`${url}${base}/System/Info/Public`, { signal: AbortSignal.timeout(5000), redirect: 'manual' })
        if (r.ok && /json/.test(r.headers.get('content-type') ?? '')) return base
      } catch {
        /* try next */
      }
    }
    await new Promise((r) => setTimeout(r, 1500))
  } while (Date.now() < until)
  throw new WireError("Jellyfin isn't answering")
}

export async function wireJellyfin(o: JellyfinSetup, step: (msg: string) => void): Promise<{ apiKey: string; basePath: string; adminId: string }> {
  let base = await jfBase(o.url)
  const J = () => `${o.url}${base}`
  const info = await http<{ StartupWizardCompleted?: boolean }>('GET', `${J()}/System/Info/Public`)
  if (!info.StartupWizardCompleted) {
    step('Running Jellyfin’s first-run setup')
    for (let attempt = 1; ; attempt++) {
      await http('POST', `${J()}/Startup/Configuration`, { headers: jfAuth(), body: { UICulture: 'en-US', MetadataCountryCode: o.country, PreferredMetadataLanguage: o.language, ServerName: o.serverName } })
      await http('GET', `${J()}/Startup/User`, { headers: jfAuth() })
      await http('POST', `${J()}/Startup/User`, { headers: jfAuth(), body: { Name: o.admin.username, Password: o.admin.password } })
      await http('POST', `${J()}/Startup/RemoteAccess`, { headers: jfAuth(), body: { EnableRemoteAccess: true, EnableAutomaticPortMapping: false } })
      await http('POST', `${J()}/Startup/Complete`, { headers: jfAuth() })
      const after = await http<{ StartupWizardCompleted?: boolean }>('GET', `${J()}/System/Info/Public`)
      if (after.StartupWizardCompleted) break
      if (attempt >= 3) throw new WireError('Jellyfin didn’t finish its first-run setup — try again in a minute')
      await new Promise((r) => setTimeout(r, 5000))
    }
  }

  // A token with admin rights: a stored API key, else sign in as the admin.
  let token = o.apiKey
  let adminId = ''
  if (token) {
    const ok = await fetch(`${J()}/Users`, { headers: jfAuth(token), signal: AbortSignal.timeout(10000) }).then((r) => r.ok).catch(() => false)
    if (!ok) token = undefined
  }
  if (!token) {
    step('Signing in to Jellyfin')
    const auth = await http<{ AccessToken: string; User: { Id: string } }>('POST', `${J()}/Users/AuthenticateByName`, {
      headers: jfAuth(),
      body: { Username: o.admin.username, Pw: o.admin.password },
    }).catch((e) => {
      throw new WireError(`Couldn't sign in to Jellyfin as ${o.admin.username} (${(e as Error).message})`)
    })
    if (!auth?.AccessToken) throw new WireError(`Jellyfin didn’t accept the sign-in for ${o.admin.username} yet — try again in a minute`)
    token = auth.AccessToken
    adminId = auth.User?.Id ?? ''
  }
  if (!adminId) {
    const users = await http<{ Id: string; Name: string; Policy?: { IsAdministrator?: boolean } }[]>('GET', `${J()}/Users`, { headers: jfAuth(token) })
    adminId = (users.find((u) => u.Name.toLowerCase() === o.admin.username.toLowerCase()) ?? users.find((u) => u.Policy?.IsAdministrator))?.Id ?? ''
  }

  // Libraries
  const want: [boolean, string, string, string][] = [
    [o.libraries.movies, 'Movies', 'movies', '/data/media/movies'],
    [o.libraries.shows, 'Shows', 'tvshows', '/data/media/tv'],
    [o.libraries.music, 'Music', 'music', '/data/media/music'],
  ]
  const folders = await http<{ Name: string; Locations: string[] }[]>('GET', `${J()}/Library/VirtualFolders`, { headers: jfAuth(token) })
  for (const [enabled, name, type, path] of want) {
    if (!enabled || folders.some((f) => f.Locations.includes(path))) continue
    step(`Creating the ${name} library`)
    const q = new URLSearchParams({ name, collectionType: type, paths: path, refreshLibrary: 'false' })
    await http('POST', `${J()}/Library/VirtualFolders?${q}`, {
      headers: jfAuth(token),
      body: { LibraryOptions: { EnableRealtimeMonitor: true, EnableChapterImageExtraction: false, SaveLocalMetadata: false, EnableTrickplayImageExtraction: true, ExtractTrickplayImagesDuringLibraryScan: false } },
    })
  }

  // Finesse's own API key
  let apiKey = o.apiKey
  const keys = await http<{ Items: { AppName: string; AccessToken: string }[] }>('GET', `${J()}/Auth/Keys`, { headers: jfAuth(token) })
  const existing = keys.Items.find((k) => k.AppName === 'Finesse')
  if (existing) apiKey = existing.AccessToken
  if (!apiKey || !existing) {
    step('Creating Finesse’s Jellyfin key')
    await http('POST', `${J()}/Auth/Keys?app=Finesse`, { headers: jfAuth(token) })
    const again = await http<{ Items: { AppName: string; AccessToken: string }[] }>('GET', `${J()}/Auth/Keys`, { headers: jfAuth(token) })
    apiKey = again.Items.find((k) => k.AppName === 'Finesse')?.AccessToken
    if (!apiKey) throw new WireError('Jellyfin didn’t return the new API key')
  }

  // Serve under /jellyfin (Finesse proxies it there). New installs are seeded
  // that way; an older one is switched here and restarted (BaseUrl only
  // applies on start).
  if (base !== '/jellyfin' && o.restart) {
    step('Moving Jellyfin under /jellyfin')
    const net = await http<Record<string, unknown>>('GET', `${J()}/System/Configuration/network`, { headers: jfAuth(apiKey) })
    net.BaseUrl = '/jellyfin'
    await http('POST', `${J()}/System/Configuration/network`, { headers: jfAuth(apiKey), body: net })
    await o.restart()
    // Only the new address counts: just after a restart it can still answer on the old one.
    base = await jfBase(o.url, 180000, '/jellyfin')
  }
  return { apiKey, basePath: base, adminId }
}

/** Kicks off a library scan (after new media lands or on setup). */
export async function jellyfinScan(url: string, apiKey: string) {
  await http('POST', `${url}/Library/Refresh`, { headers: jfAuth(apiKey) })
}

// ---------------------------------------------------------------------------
// Servarr apps
// ---------------------------------------------------------------------------

type Field = { name: string; value?: unknown; type?: string; selectOptions?: { value: unknown; name: string }[] }
type Thing = { id?: number; name: string; implementation: string; configContract?: string; fields: Field[]; [k: string]: unknown }

export class Arr {
  readonly base: string
  readonly key: string
  readonly api: string

  constructor(url: string, key: string, api: 'v1' | 'v3') {
    this.base = url.replace(/\/+$/, '')
    this.key = key
    this.api = api
  }

  req<T = unknown>(method: string, path: string, body?: unknown, timeoutMs?: number) {
    return http<T>(method, `${this.base}/api/${this.api}${path}`, { headers: { 'X-Api-Key': this.key }, body, timeoutMs })
  }

  /** Upserts a download client / notification / application from the schema. */
  async upsert(kind: 'downloadclient' | 'notification' | 'applications' | 'indexer', match: (t: Thing) => boolean, build: (schema: Thing[]) => Thing, opts: { test?: boolean } = {}) {
    const existing = (await this.req<Thing[]>('GET', `/${kind}`)).find(match)
    const schema = await this.req<Thing[]>('GET', `/${kind}/schema`)
    const next = build(schema)
    if (existing) {
      // Keep the id (and anything we don't manage); overwrite our fields.
      const merged = { ...existing, ...next, id: existing.id, fields: mergeFields(existing.fields, next.fields) }
      await this.req('PUT', `/${kind}/${existing.id}?forceSave=${opts.test ? 'false' : 'true'}`, merged)
      return existing.id!
    }
    const created = await this.req<Thing>('POST', `/${kind}?forceSave=${opts.test ? 'false' : 'true'}`, next)
    return created.id!
  }
}

function mergeFields(old: Field[], next: Field[]): Field[] {
  const map = new Map(old.map((f) => [f.name, f]))
  for (const f of next) map.set(f.name, { ...(map.get(f.name) ?? {}), ...f })
  return [...map.values()]
}

/** Takes a schema entry and sets field values by name. */
export function fromSchema(schema: Thing[], implementation: string, values: Record<string, unknown>, extra: Record<string, unknown> = {}, pick?: (t: Thing) => boolean): Thing {
  const tpl = schema.find((s) => s.implementation === implementation && (!pick || pick(s)))
  if (!tpl) throw new WireError(`${implementation} isn't available in this app version`)
  const t: Thing = structuredClone(tpl)
  for (const f of t.fields) if (f.name in values) f.value = values[f.name]
  for (const [k, v] of Object.entries(values)) if (!t.fields.some((f) => f.name === k)) t.fields.push({ name: k, value: v })
  delete t.id
  return { ...t, ...extra }
}

/** The "<kind>Category" field an *arr uses for its download clients. */
function categoryField(t: Thing): string | undefined {
  return t.fields.find((f) => /Category$/.test(f.name) && !/Imported|Older|Recent/i.test(f.name))?.name
}

export interface ArrWiring {
  app: 'sonarr' | 'radarr' | 'lidarr'
  arr: Arr
  rootFolder: string
  sab?: { host: string; port: number; apiKey: string; category: string }
  qbit?: { host: string; port: number; username: string; password: string; category: string }
  jellyfin?: { host: string; port: number; urlBase: string; apiKey: string }
}

export async function wireArr(w: ArrWiring, step: (msg: string) => void) {
  const { arr, app } = w
  const title = app[0]!.toUpperCase() + app.slice(1)

  // Root folder
  const roots = await arr.req<{ path: string }[]>('GET', '/rootfolder')
  if (!roots.some((r) => r.path.replace(/\/+$/, '') === w.rootFolder)) {
    step(`${title}: library folder`)
    if (app === 'lidarr') {
      const qp = await arr.req<{ id: number; name: string }[]>('GET', '/qualityprofile')
      const mp = await arr.req<{ id: number; name: string }[]>('GET', '/metadataprofile')
      await arr.req('POST', '/rootfolder', {
        name: 'Music',
        path: w.rootFolder,
        defaultQualityProfileId: (qp.find((p) => p.name === 'Standard') ?? qp[0])?.id,
        defaultMetadataProfileId: (mp.find((p) => p.name === 'Standard') ?? mp[0])?.id,
        defaultMonitorOption: 'all',
        defaultNewItemMonitorOption: 'all',
        defaultTags: [],
      })
    } else {
      await arr.req('POST', '/rootfolder', { path: w.rootFolder })
    }
  }

  // Download clients
  if (w.sab) {
    step(`${title}: connecting SABnzbd`)
    const sab = w.sab
    await arr.upsert(
      'downloadclient',
      (t) => t.implementation === 'Sabnzbd',
      (schema) => {
        const t = fromSchema(schema, 'Sabnzbd', { host: sab.host, port: sab.port, apiKey: sab.apiKey, useSsl: false }, { name: 'SABnzbd', enable: true, priority: 1, removeCompletedDownloads: true, removeFailedDownloads: true })
        const cat = categoryField(t)
        if (cat) t.fields.find((f) => f.name === cat)!.value = sab.category
        return t
      },
    )
  }
  if (w.qbit) {
    step(`${title}: connecting qBittorrent`)
    const q = w.qbit
    await arr.upsert(
      'downloadclient',
      (t) => t.implementation === 'QBittorrent',
      (schema) => {
        const t = fromSchema(schema, 'QBittorrent', { host: q.host, port: q.port, username: q.username, password: q.password, useSsl: false }, { name: 'qBittorrent', enable: true, priority: 1, removeCompletedDownloads: true, removeFailedDownloads: true })
        const cat = categoryField(t)
        if (cat) t.fields.find((f) => f.name === cat)!.value = q.category
        return t
      },
    )
  }

  // Tell Jellyfin when something lands (library refresh).
  if (w.jellyfin) {
    step(`${title}: telling Jellyfin about new downloads`)
    const j = w.jellyfin
    await arr.upsert(
      'notification',
      (t) => t.implementation === 'MediaBrowser',
      (schema) => {
        const t = fromSchema(schema, 'MediaBrowser', { host: j.host, port: j.port, useSsl: false, urlBase: j.urlBase, apiKey: j.apiKey, notify: false, updateLibrary: true }, { name: 'Jellyfin' })
        // Every "on…" event the notification supports, except noisy ones.
        for (const k of Object.keys(t)) {
          if (!/^on[A-Z]/.test(k)) continue
          const supported = t[`supports${k[0]!.toUpperCase()}${k.slice(1)}`]
          t[k] = supported !== false && !/Grab|Health|ApplicationUpdate|ManualInteraction/.test(k)
        }
        return t
      },
    )
  }

  // Rename files into tidy, Jellyfin-friendly names.
  try {
    const naming = await arr.req<Record<string, unknown>>('GET', '/config/naming')
    const renameKey = Object.keys(naming).find((k) => /^rename(Movies|Episodes|Tracks)$/.test(k))
    if (renameKey && naming[renameKey] !== true) {
      naming[renameKey] = true
      await arr.req('PUT', `/config/naming/${naming.id}`, naming)
    }
  } catch (e) {
    log.warn(`${app} naming: ${(e as Error).message}`)
  }
}

// ---------------------------------------------------------------------------
// Languages (Sonarr + Radarr)
// ---------------------------------------------------------------------------

/** Setup language codes → the names Sonarr and Radarr give those languages. */
const ARR_LANGUAGE: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', 'pt-BR': 'Portuguese (Brazil)',
  nl: 'Dutch', sv: 'Swedish', nb: 'Norwegian', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', cs: 'Czech',
  hu: 'Hungarian', ro: 'Romanian', el: 'Greek', tr: 'Turkish', ru: 'Russian', uk: 'Ukrainian', ar: 'Arabic', he: 'Hebrew',
  hi: 'Hindi', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
}
/** Custom formats Finesse owns (matched by name, so re-running updates them). */
export const LANGUAGE_BLOCK = 'Finesse: not your languages'
export const LANGUAGE_PREFER = 'Finesse: original language'
const BLOCK_SCORE = -10000
const PREFER_SCORE = 10
/** Sonarr/Radarr's own ids for "Original", "Unknown" and (Radarr's profile) "Any". */
const ORIGINAL = -2
const UNKNOWN = 0
const ANY = -1

type Spec = { name: string; implementation: string; negate: boolean; required: boolean; fields: Field[]; [k: string]: unknown }
type CustomFormat = { id?: number; name: string; includeCustomFormatWhenRenaming?: boolean; specifications: Spec[] }
type Profile = { id: number; name: string; language?: { id: number; name: string }; formatItems: { format: number; name?: string; score: number }[]; [k: string]: unknown }

/** A custom format's rules, reduced to what matters for "is it already right?". */
const shape = (cf: Pick<CustomFormat, 'specifications'>) =>
  JSON.stringify(cf.specifications.map((x) => [x.implementation, x.negate, x.required, x.fields.find((f) => f.name === 'value')?.value]).sort())

/**
 * Downloads come in the title's original language or the household's, never
 * in a language nobody at home speaks: a German release of an English show,
 * say (Sonarr v4 has no language setting of its own, so it would take one).
 * Releases without a language tag pass, so a missing tag never blocks
 * everything, and the original language (or dual audio) wins a tie. Radarr's
 * profiles go from "Original" to "Any" so English dubs of foreign films are
 * allowed the same way. Safe to re-run: only what differs is written.
 */
export async function wireLanguages(arr: Arr, app: 'sonarr' | 'radarr', household: string, step: (msg: string) => void) {
  const title = app[0]!.toUpperCase() + app.slice(1)
  const schema = await arr.req<Spec[]>('GET', '/customformat/schema')
  const tpl = schema.find((x) => x.implementation === 'LanguageSpecification')
  if (!tpl) throw new WireError(`${title} has no language rules in this version`)
  const options = tpl.fields.find((f) => f.name === 'value')?.selectOptions ?? []
  const idOf = (name?: string) => (name ? (options.find((o) => o.name.toLowerCase() === name.toLowerCase())?.value as number | undefined) : undefined)
  const langName = ARR_LANGUAGE[household] ?? ARR_LANGUAGE[household.split('-')[0]!]
  const mine = idOf(langName)
  step(`${title}: downloads in the original language${mine !== undefined ? ` or ${langName}` : ''}`)

  const spec = (name: string, value: number, negate: boolean, required: boolean): Spec => {
    const x = structuredClone(tpl)
    delete (x as { id?: number }).id
    return { ...x, name, negate, required, fields: x.fields.map((f) => (f.name === 'value' ? { ...f, value } : f)) }
  }
  const wanted: CustomFormat[] = [{ name: LANGUAGE_PREFER, includeCustomFormatWhenRenaming: false, specifications: [spec('Original language', ORIGINAL, false, false)] }]
  // Without a household language to allow, blocking would also block dubs in it.
  if (mine !== undefined) {
    wanted.push({
      name: LANGUAGE_BLOCK,
      includeCustomFormatWhenRenaming: false,
      specifications: [
        spec('Not the original language', ORIGINAL, true, true),
        spec(`Not ${langName}`, mine, true, true),
        spec('Language is known', UNKNOWN, true, true),
      ],
    })
  }

  const existing = await arr.req<CustomFormat[]>('GET', '/customformat')
  const ids: Record<string, number> = {}
  for (const cf of wanted) {
    const have = existing.find((x) => x.name === cf.name)
    if (!have) ids[cf.name] = (await arr.req<CustomFormat>('POST', '/customformat', cf)).id!
    else {
      ids[cf.name] = have.id!
      if (shape(have) !== shape(cf)) await arr.req('PUT', `/customformat/${have.id}`, { ...cf, id: have.id })
    }
  }
  // Household language changed to one we can't map: the old block would now be wrong.
  const stale = mine === undefined ? existing.find((x) => x.name === LANGUAGE_BLOCK) : undefined
  if (stale) await arr.req('DELETE', `/customformat/${stale.id}`)

  const scores: Record<number, number> = { [ids[LANGUAGE_PREFER]!]: PREFER_SCORE }
  if (ids[LANGUAGE_BLOCK] !== undefined) scores[ids[LANGUAGE_BLOCK]] = BLOCK_SCORE
  for (const p of await arr.req<Profile[]>('GET', '/qualityprofile')) {
    let changed = false
    for (const [format, score] of Object.entries(scores).map(([f, sc]) => [Number(f), sc] as const)) {
      const item = p.formatItems.find((i) => i.format === format)
      if (!item) {
        p.formatItems.push({ format, score })
        changed = true
      } else if (item.score !== score) {
        item.score = score
        changed = true
      }
    }
    // Radarr's default: only the original language. Our rule decides instead.
    if (app === 'radarr' && p.language?.id === ORIGINAL) {
      p.language = { id: ANY, name: 'Any' }
      changed = true
    }
    if (changed) await arr.req('PUT', `/qualityprofile/${p.id}`, p)
  }
}

// ---------------------------------------------------------------------------
// Prowlarr
// ---------------------------------------------------------------------------

export interface IndexerInput {
  name: string
  kind: 'newznab' | 'torznab'
  /** The indexer's address. Left out for one of Prowlarr's own search sites, named by `definition`. */
  url?: string
  apiKey?: string
  /** A Prowlarr definition name (e.g. "nzbgeek"); omitted = generic. With no `url` it is one of Prowlarr's built-in sites: no address or key. */
  definition?: string
}

/** "Internet Archive", "internet-archive" and "internetarchive" are the same site. */
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export async function wireProwlarr(
  prowlarr: Arr,
  o: { selfUrl: string; apps: { app: 'sonarr' | 'radarr' | 'lidarr'; url: string; apiKey: string }[]; indexers: IndexerInput[] },
  step: (msg: string) => void,
): Promise<{ indexerErrors: { name: string; error: string }[] }> {
  for (const a of o.apps) {
    const impl = a.app[0]!.toUpperCase() + a.app.slice(1)
    step(`Prowlarr: syncing indexers to ${impl}`)
    await prowlarr.upsert(
      'applications',
      (t) => t.implementation === impl,
      (schema) => fromSchema(schema, impl, { prowlarrUrl: o.selfUrl, baseUrl: a.url, apiKey: a.apiKey }, { name: impl, syncLevel: 'fullSync' }),
    )
  }
  const indexerErrors: { name: string; error: string }[] = []
  let saved = 0
  for (const ix of o.indexers) {
    step(`Prowlarr: adding ${ix.name}`)
    const impl = ix.kind === 'torznab' ? 'Torznab' : 'Newznab'
    const builtIn = Boolean(ix.definition) && !ix.url
    try {
      await prowlarr.upsert(
        'indexer',
        (t) => t.name === ix.name,
        (schema) => {
          if (builtIn) {
            // One of Prowlarr's own sites: found by name in its list, saved as it comes (nothing to type in).
            const want = norm(ix.definition)
            const tpl = schema.find((t) => norm(t.definitionName) === want) ?? schema.find((t) => norm(t.name) === want)
            if (!tpl) throw new WireError(`this Prowlarr doesn't list ${ix.name}. Add it from Prowlarr's own Indexers page if you want it`)
            return fromSchema(schema, tpl.implementation, {}, { name: ix.name, enable: true, appProfileId: 1, priority: 25 }, (t) => t === tpl)
          }
          const pick = (t: Thing) =>
            ix.definition ? String(t.definitionName ?? '').toLowerCase() === ix.definition.toLowerCase() : /^(generic )?(newznab|torznab)$/i.test(String(t.definitionName ?? t.name))
          const values: Record<string, unknown> = { baseUrl: (ix.url ?? '').replace(/\/+$/, '') }
          if (ix.apiKey) values.apiKey = ix.apiKey
          return fromSchema(schema, impl, values, { name: ix.name, enable: true, appProfileId: 1, priority: 25 }, pick)
        },
      )
      saved++
    } catch (e) {
      // "POST /api/v1/indexer → 400: Credentials appear…" → just the reason.
      indexerErrors.push({ name: ix.name, error: (e as Error).message.replace(/^[A-Z]+ \S+ → \d+: /, '') })
    }
  }
  // Saving an indexer already makes Prowlarr push it to every app (a second
  // sync at the same time trips over the first); otherwise ask for one.
  if (!saved) await prowlarr.req('POST', '/command', { name: 'ApplicationIndexerSync' }).catch(() => {})
  return { indexerErrors }
}

// ---------------------------------------------------------------------------
// SABnzbd
// ---------------------------------------------------------------------------

export interface UsenetServer {
  name: string
  host: string
  port: number
  ssl: boolean
  username: string
  password: string
  connections: number
  priority?: number
}

export async function wireSab(url: string, apiKey: string, servers: UsenetServer[], step: (msg: string) => void) {
  const call = (params: Record<string, string | number>) =>
    http<{ config?: unknown; status?: boolean; error?: string }>('GET', `${url}/api?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), output: 'json', apikey: apiKey })}`)
  for (const s of servers) {
    step(`SABnzbd: adding ${s.name}`)
    const keyword = s.name.replace(/[^A-Za-z0-9_-]/g, '_') || 'Provider'
    await call({
      mode: 'set_config',
      section: 'servers',
      keyword,
      name: keyword,
      displayname: s.name,
      host: s.host,
      port: s.port,
      ssl: s.ssl === false ? 0 : 1,
      ssl_verify: 2,
      username: s.username,
      password: s.password,
      connections: s.connections,
      priority: s.priority ?? 0,
      enable: 1,
    })
  }
}

/** Asks SABnzbd to test a server (used when SABnzbd is already running). */
export async function sabTestServer(url: string, apiKey: string, s: UsenetServer): Promise<{ ok: boolean; message: string }> {
  const r = await http<{ value?: { result: boolean; message: string } }>(
    'GET',
    `${url}/api?${new URLSearchParams({ mode: 'config', name: 'test_server', host: s.host, port: String(s.port), ssl: s.ssl === false ? '0' : '1', username: s.username, password: s.password, connections: String(s.connections), output: 'json', apikey: apiKey })}`,
    { timeoutMs: 60000 },
  )
  return { ok: Boolean(r.value?.result), message: r.value?.message ?? '' }
}

// ---------------------------------------------------------------------------
// qBittorrent
// ---------------------------------------------------------------------------

export async function wireQbit(url: string, categories: Record<string, string>, step: (msg: string) => void) {
  // Finesse's network is in qBittorrent's auth-bypass whitelist; no login needed.
  const existing = await http<Record<string, unknown>>('GET', `${url}/api/v2/torrents/categories`).catch(() => ({}))
  for (const [name, savePath] of Object.entries(categories)) {
    if (name in existing) continue
    step(`qBittorrent: category ${name}`)
    await http('POST', `${url}/api/v2/torrents/createCategory`, { form: { category: name, savePath }, okStatuses: [409] })
  }
}

// ---------- RomM (Games) ----------

/** RomM: make sure Finesse's own account exists and signs in. On a fresh RomM
 *  the first account created becomes its administrator; after that RomM only
 *  lets an admin add accounts, so a RomM that already has its own users (and
 *  not ours) is reported rather than guessed at. */
export async function wireRomm(url: string, creds: { username: string; password: string }, say: (m: string) => void): Promise<void> {
  const hb = await http<{ SYSTEM?: { SHOW_SETUP_WIZARD?: boolean } }>('GET', `${url}/api/heartbeat`)
  if (hb.SYSTEM?.SHOW_SETUP_WIZARD) {
    say('Creating Finesse’s Games account')
    // Unauthenticated writes need RomM's CSRF cookie + header.
    const first = await fetch(`${url}/api/heartbeat`, { signal: AbortSignal.timeout(15000) })
    const cookie = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const token = /romm_csrftoken=([^;]+)/.exec(cookie)?.[1] ?? ''
    const res = await fetch(`${url}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie, 'x-csrftoken': token },
      body: JSON.stringify({ username: creds.username, password: creds.password, email: `${creds.username}@finesse.local`, role: 'admin' }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new WireError(`RomM didn’t accept Finesse’s account (${res.status}: ${(await res.text()).slice(0, 160)})`)
  }
  const me = await fetch(`${url}/api/users/me`, {
    headers: { authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!me.ok)
    throw new WireError(
      'RomM already has its own accounts, and Finesse can’t sign in to it. To start Games fresh, delete the config/romm and config/romm-db folders and try again.',
    )
}
