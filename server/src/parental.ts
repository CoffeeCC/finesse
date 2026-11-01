// Parental limits: a profile can be limited to titles rated up to an age ("up to PG"), with
// unrated films and shows blocked or not, and with requests on or off.
//
// Where it's enforced, on this server:
//   - Jellyfin itself: the profile's own rating limit (MaxParentalRating, BlockUnratedItems) is
//     set too, so Jellyfin's lists and search leave those titles out, and Jellyfin's own apps
//     (port 8096) follow it.
//   - Finesse's /jellyfin proxy, whatever Jellyfin does: any request from a limited profile (its
//     token anywhere in the request) that names a title it can't open (in the path, encoded or
//     hyphenated, or in Ids/ItemId/ParentId/SeriesId/... in the query) is refused before it
//     reaches Jellyfin: title pages, direct links, PlaybackInfo, streams, subtitles, downloads.
//     JSON lists coming back (Items, SearchHints, Latest) are checked title by title.
//   - Friends' servers (Groups) are off for limited profiles: Finesse can't check their ratings.
//   - Requests (the /arr proxies, album requests) are off unless allowed.
//   - Moments, shortlists, Moments collections, watch parties and preview clips check the same
//     rule (access.ts).
// Not covered: games and game streaming (no ratings), and a profile with no password can be
// opened by anyone on a device that lists it.
//
// A title's age comes from its rating (CustomRating over OfficialRating), read with the
// server's key; an episode or season without one takes its show's. Unknown rating strings
// count as unrated.

import type { IncomingMessage } from 'node:http'
import type { Auth } from './auth.ts'
import { groupUserIds } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import type { Jellyfin } from './jellyfin.ts'
import { logger } from './log.ts'

const log = logger('parental')

export interface Limit {
  /** Titles rated for this age and under. */
  maxAge: number
  /** Films and shows with no (known) rating are blocked too. */
  blockUnrated: boolean
  /** May request titles (Radarr/Sonarr/Lidarr). */
  requests: boolean
}

export const AGE_CHOICES: { age: number; label: string }[] = [
  { age: 0, label: 'All ages (G, TV-G, TV-Y, U)' },
  { age: 7, label: 'Up to 7 (TV-Y7)' },
  { age: 10, label: 'Up to 10 (PG, TV-PG)' },
  { age: 14, label: 'Up to 14 (PG-13, TV-14, 12A)' },
  { age: 16, label: 'Up to 16 (15, 16; not R or TV-MA)' },
]

/** Rating → the age it's for. Country prefixes ("US-", "DE-") are dropped first. */
const TABLE: Record<string, number> = {
  // US film and TV
  G: 0, 'TV-G': 0, 'TV-Y': 0, E: 0, EC: 0, APPROVED: 0,
  'TV-Y7': 7, 'TV-Y7-FV': 7,
  PG: 10, 'TV-PG': 10,
  'PG-13': 13, T: 13,
  'TV-14': 14,
  R: 17, 'TV-MA': 17, M: 17,
  'NC-17': 18, X: 18, XXX: 18, AO: 18,
  // UK
  U: 0, UC: 0, '12A': 12, '12': 12, '15': 15, '18': 18, R18: 18,
  // Germany
  'FSK-0': 0, 'FSK-6': 6, 'FSK-12': 12, 'FSK-16': 16, 'FSK-18': 18,
  // Canada, Australia
  '14A': 14, '18A': 18, 'MA15+': 15, 'R18+': 18,
  // plain ages
  '0': 0, '6': 6, '7': 7, '10': 10, '13': 13, '14': 14, '16': 16,
}
const UNRATED = new Set(['', 'NR', 'UR', 'UNRATED', 'NOT RATED', 'UNKNOWN'])

/** The age a rating is for; null when there's none, or it isn't one Finesse knows. */
export function ratingAge(rating: string | null | undefined): number | null {
  let r = String(rating ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (UNRATED.has(r)) return null
  if (r in TABLE) return TABLE[r]!
  r = r.replace(/^[A-Z]{2}[-: ]/, '')
  if (r in TABLE) return TABLE[r]!
  const fsk = /^FSK ?(\d{1,2})$/.exec(r)
  if (fsk) return Number(fsk[1])
  return null
}

/** Kinds of item a rating applies to: these are blocked when unrated (if asked). Folders, people, music aren't. */
const TITLE_TYPES = new Set(['Movie', 'Series', 'Season', 'Episode', 'Video', 'Trailer', 'MusicVideo'])

export function ageAllowed(age: number | null, type: string, limit: Limit): boolean {
  if (age !== null) return age <= limit.maxAge
  return !(limit.blockUnrated && TITLE_TYPES.has(type))
}

export function cleanLimit(body: Record<string, unknown>): Limit | null {
  if (body.maxAge === null) return null
  const age = Number(body.maxAge)
  if (!AGE_CHOICES.some((c) => c.age === age)) throw new ApiError(400, 'Pick one of the rating limits on the list')
  return { maxAge: age, blockUnrated: body.blockUnrated !== false, requests: body.requests === true }
}

const HEX = /[0-9a-f]{32}/g
const HYPHENATED = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
/** Query keys that name items. */
const ID_KEYS = new Set(['ids', 'id', 'itemid', 'itemids', 'mediasourceid', 'parentid', 'seriesid', 'seasonid', 'startitemid', 'albumid', 'excludeitemids'])

/** Every item id a Jellyfin request names: in its path (decoded, any case, hyphenated or not) and its id parameters. */
export function idsIn(path: string, query: URLSearchParams): string[] {
  const out = new Set<string>()
  const scan = (s: string) => {
    let t = s
    for (let i = 0; i < 3; i++) {
      try {
        const d = decodeURIComponent(t)
        if (d === t) break
        t = d
      } catch {
        break
      }
    }
    t = t.toLowerCase().replace(HYPHENATED, (m) => m.replace(/-/g, ''))
    for (const m of t.match(HEX) ?? []) out.add(m)
  }
  scan(path)
  for (const [k, v] of query) if (ID_KEYS.has(k.toLowerCase())) scan(v)
  return [...out]
}

interface Known {
  exists: boolean
  type: string
  age: number | null
  at: number
}

export class Parental {
  private settings: SettingsStore
  private jf: Jellyfin
  private auth: Auth
  private known = new Map<string, Known>()

  constructor(deps: { settings: SettingsStore; jf: Jellyfin; auth: Auth }) {
    this.settings = deps.settings
    this.jf = deps.jf
    this.auth = deps.auth
  }

  limits(): Record<string, Limit> {
    return this.settings.get().parental ?? {}
  }
  any(): boolean {
    return Object.keys(this.limits()).length > 0
  }
  limitOf(userId: string): Limit | null {
    return this.limits()[userId.toLowerCase()] ?? null
  }

  /** The limited profile behind a request, if any: every token it carries is checked, so one can't hide behind another. */
  async limitedIn(req: IncomingMessage, query?: URLSearchParams): Promise<{ id: string; limit: Limit } | null> {
    if (!this.any()) return null
    for (const token of allTokens(req, query)) {
      const u = await this.auth.userFor(token).catch(() => null)
      const l = u ? this.limitOf(u.Id) : null
      if (u && l) return { id: u.Id.toLowerCase(), limit: l }
    }
    return null
  }

  /** What we know of items (type and age), read with the server's key in batches, kept 10 minutes. */
  async describe(ids: string[]): Promise<Map<string, Known>> {
    const out = new Map<string, Known>()
    const now = Date.now()
    const need: string[] = []
    for (const id of ids) {
      const k = this.known.get(id)
      if (k && now - k.at < 10 * 60e3) out.set(id, k)
      else need.push(id)
    }
    for (let i = 0; i < need.length; i += 100) {
      const batch = need.slice(i, i + 100)
      const r = await this.jf.request<{ Items?: { Id: string; Type?: string; OfficialRating?: string; CustomRating?: string; SeriesId?: string }[] }>(
        `/Items?Ids=${batch.join(',')}&Recursive=true&Fields=CustomRating,OfficialRating&EnableImages=false&EnableUserData=false&EnableTotalRecordCount=false`,
        { timeoutMs: 15000 },
      )
      const found = new Map((r?.Items ?? []).map((it) => [String(it.Id).toLowerCase(), it]))
      // Episodes and seasons without a rating take their show's.
      const shows = [...found.values()].filter((it) => (it.Type === 'Episode' || it.Type === 'Season') && ratingAge(it.CustomRating || it.OfficialRating) === null && it.SeriesId).map((it) => String(it.SeriesId).toLowerCase())
      const showAges = shows.length ? await this.describe([...new Set(shows)].filter((s) => !batch.includes(s))) : new Map<string, Known>()
      for (const id of batch) {
        const it = found.get(id)
        let k: Known
        if (!it) k = { exists: false, type: '', age: null, at: now }
        else {
          let age = ratingAge(it.CustomRating || it.OfficialRating)
          if (age === null && it.SeriesId) {
            const sid = String(it.SeriesId).toLowerCase()
            const show = showAges.get(sid) ?? out.get(sid) ?? (found.has(sid) ? { age: ratingAge(found.get(sid)!.CustomRating || found.get(sid)!.OfficialRating) } : null)
            age = show?.age ?? null
          }
          k = { exists: true, type: String(it.Type ?? ''), age, at: now }
        }
        if (this.known.size > 50000) this.known.clear()
        this.known.set(id, k)
        out.set(id, k)
      }
    }
    return out
  }

  /** Whether these ids are all fine for this limit (ids that aren't items, like user ids, are). A failed read refuses. */
  async allowsAll(limit: Limit, ids: string[]): Promise<boolean> {
    if (!ids.length) return true
    const known = await this.describe(ids)
    return ids.every((id) => {
      const k = known.get(id)
      return !k || !k.exists || ageAllowed(k.age, k.type, limit)
    })
  }

  /** Whether one of our people may open this title of ours. */
  async allows(userId: string, raw: string): Promise<boolean> {
    const l = this.limitOf(userId)
    if (!l) return true
    return this.allowsAll(l, [raw.toLowerCase()]).catch(() => false)
  }

  /** A JSON reply for a limited profile, with the titles it can't open taken out of its lists. */
  async filterJson(text: string, limit: Limit): Promise<string> {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return text
    }
    const lists: unknown[][] = []
    if (Array.isArray(data)) lists.push(data)
    else if (data && typeof data === 'object') {
      for (const key of ['Items', 'SearchHints']) {
        const v = (data as Record<string, unknown>)[key]
        if (Array.isArray(v)) lists.push(v)
      }
    }
    const idOf = (x: unknown) => {
      const o = x as { Id?: unknown; ItemId?: unknown; Type?: unknown }
      const id = String(o?.Id ?? o?.ItemId ?? '').toLowerCase().replace(/-/g, '')
      return /^[0-9a-f]{32}$/.test(id) ? id : null
    }
    const ids = [...new Set(lists.flat().map(idOf).filter((x): x is string => !!x))]
    if (!ids.length) return text
    const known = await this.describe(ids)
    let removed = 0
    const keep = (x: unknown) => {
      const id = idOf(x)
      const k = id ? known.get(id) : undefined
      const ok = !k || !k.exists || ageAllowed(k.age, k.type, limit)
      if (!ok) removed++
      return ok
    }
    if (Array.isArray(data)) return JSON.stringify(data.filter(keep))
    const o = data as Record<string, unknown>
    for (const key of ['Items', 'SearchHints']) if (Array.isArray(o[key])) o[key] = (o[key] as unknown[]).filter(keep)
    if (removed) {
      if (typeof o.TotalRecordCount === 'number') o.TotalRecordCount = Math.max(0, o.TotalRecordCount - removed)
    }
    return JSON.stringify(o)
  }

  /** Jellyfin's own limit for the profile (or none), so its lists and its own apps follow it too. */
  async syncJellyfin(userId: string, limit: Limit | null): Promise<boolean> {
    try {
      const full = await this.jf.request<{ Policy?: Record<string, unknown> }>(`/Users/${userId}`)
      const policy = { ...(full.Policy ?? {}), MaxParentalRating: limit ? limit.maxAge : null, BlockUnratedItems: limit?.blockUnrated ? ['Movie', 'Trailer', 'Series', 'Other'] : [] }
      await this.jf.request(`/Users/${userId}/Policy`, { method: 'POST', body: policy })
      return true
    } catch (e) {
      log.warn(`couldn’t set Jellyfin’s rating limit: ${(e as Error).message}`)
      return false
    }
  }
}

/** Every token a request carries, in every form Jellyfin accepts. */
export function allTokens(req: IncomingMessage, query?: URLSearchParams): string[] {
  const out = new Set<string>()
  const h = req.headers
  for (const v of [h['x-emby-token'], h['x-mediabrowser-token']]) if (typeof v === 'string' && v.trim()) out.add(v.trim())
  for (const v of [h.authorization, h['x-emby-authorization']]) {
    if (typeof v !== 'string' || !v.trim()) continue
    for (const m of v.matchAll(/Token="([^"]+)"/gi)) out.add(m[1]!)
    if (/^bearer\s+/i.test(v)) out.add(v.replace(/^bearer\s+/i, '').trim())
    else if (!/^(mediabrowser|emby)\s/i.test(v)) out.add(v.trim())
  }
  if (typeof h.cookie === 'string') for (const part of h.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (/^finesse_.*token$/.test(k ?? '') && rest.length) out.add(decodeURIComponent(rest.join('=')))
  }
  if (query) for (const [k, v] of query) if (/^(api_?key|apikey)$/i.test(k) && v.trim()) out.add(v.trim())
  return [...out]
}

export function registerParental(router: Router, deps: { settings: SettingsStore; auth: Auth; parental: Parental; jf: Jellyfin }) {
  const { settings, auth, parental, jf } = deps

  // Administrators: everyone here and their limits.
  router.get('/api/parental', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const viewers = groupUserIds(settings.get())
    const users = await jf.request<{ Id: string; Name: string; Policy?: { IsAdministrator?: boolean; IsDisabled?: boolean } }[]>('/Users').catch(() => [])
    sendJson(res, 200, {
      choices: AGE_CHOICES,
      people: (Array.isArray(users) ? users : [])
        .filter((u) => !viewers.has(u.Id) && !u.Policy?.IsDisabled)
        .map((u) => ({ id: u.Id.toLowerCase(), name: u.Name, admin: Boolean(u.Policy?.IsAdministrator), limit: parental.limitOf(u.Id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  })

  router.put('/api/parental/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const id = String(params.id ?? '').toLowerCase()
    if (!/^[0-9a-f]{32}$/.test(id)) throw new ApiError(400, 'Which profile?')
    const user = await jf.request<{ Id: string; Name: string; Policy?: { IsAdministrator?: boolean } }>(`/Users/${id}`).catch(() => null)
    if (!user) throw new ApiError(404, 'That profile isn’t on this server')
    if (groupUserIds(settings.get()).has(user.Id)) throw new ApiError(400, 'That’s a friend’s viewer account')
    const limit = cleanLimit(await readJson(req))
    if (limit && user.Policy?.IsAdministrator) throw new ApiError(400, `${user.Name} is an administrator and could lift a limit. Make them a regular profile in Jellyfin first.`)
    settings.update((s) => {
      const all = { ...(s.parental ?? {}) }
      if (limit) all[id] = limit
      else delete all[id]
      s.parental = all
    })
    const synced = await parental.syncJellyfin(user.Id, limit)
    log.info(`${user.Name}: ${limit ? `limited to age ${limit.maxAge}` : 'no limits'}`)
    sendJson(res, 200, {
      limit,
      jellyfin: synced,
      ...(synced ? {} : { warning: 'Finesse is enforcing the limit, but Jellyfin didn’t take it: Jellyfin’s own apps aren’t limited. Check Jellyfin is running, then save again.' }),
    })
  })

  // Anyone: their own limits, so the app can leave out what they can't use.
  router.get('/api/parental/me', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    sendJson(res, 200, { limit: parental.limitOf(me.id) })
  })
}
