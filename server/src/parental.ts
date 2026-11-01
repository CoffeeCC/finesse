// Parental limits: a profile can be limited to titles rated up to an age ("up to PG"), with
// unrated films and shows blocked or not, and with requests on or off.
//
// Where it's enforced, on this server:
//   - Jellyfin itself: the profile's own rating limit (MaxParentalRating, BlockUnratedItems) is
//     set too, so Jellyfin's lists and search leave those titles out, and Jellyfin's own apps
//     (port 8096) follow it.
//   - Finesse's /jellyfin proxy, whatever Jellyfin does: the one token Jellyfin would use is
//     resolved the way Jellyfin does (jellyfinAuth), the request goes on carrying only that, and
//     any request from a limited profile that names a title it can't open (in the path, encoded or
//     hyphenated, or in Ids/ItemId/ParentId/SeriesId/... in the query) is refused before it
//     reaches Jellyfin: title pages, direct links, PlaybackInfo, streams, subtitles, downloads.
//     Ids Finesse can't find as items are refused too. JSON coming back is checked title by
//     title, all the way down (filterJson).
//   - Friends' servers (Groups) and Live TV are off for limited profiles: Finesse can't check
//     their ratings. So is Jellyfin's WebSocket (see services.ts handleUpgrade).
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
  // Elsewhere: "ALL" (Korea), "L" (Brazil), "AL" (Netherlands), "APTA" (Spain), "UA" (India)
  ALL: 0, L: 0, AL: 0, APTA: 0, TP: 0, UA: 12,
}
const UNRATED = new Set(['', 'NR', 'UR', 'UNRATED', 'NOT RATED', 'UNKNOWN'])

/** The age a rating is for; null when there's none, or it isn't one Finesse knows. */
export function ratingAge(rating: string | null | undefined): number | null {
  let r = String(rating ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (UNRATED.has(r)) return null
  if (r in TABLE) return TABLE[r]!
  r = r.replace(/^[A-Z]{2} ?[-:] ?|^[A-Z]{2} /, '').trim()
  if (UNRATED.has(r)) return null
  if (r in TABLE) return TABLE[r]!
  const fsk = /^FSK ?(\d{1,2})$/.exec(r)
  if (fsk) return Number(fsk[1])
  // National ratings that are an age with a letter or a plus: KR "19", RU "18+", NZ "R18",
  // "RP16", AU "R 18+", "X 18+", SG "M18", "NC16", "R21", JP "PG12", "R15+", CA "14+", "C8".
  const n = /^(?:R|RP|M|MA|NC|X|PG|C|K|A|B|N)?-?(\d{1,2})\+?$/.exec(r.replace(/ /g, ''))
  if (n) return Number(n[1])
  return null
}

/** Kinds of item a rating applies to: these are blocked when unrated (if asked). Folders, people, music aren't. */
const TITLE_TYPES = new Set(['Movie', 'Series', 'Season', 'Episode', 'Video', 'Trailer', 'MusicVideo'])
/** Live TV: channels and what's on them carry no rating Finesse can check, so limited profiles don't get it. */
const LIVE_TYPES = new Set(['tvchannel', 'livetvchannel', 'program', 'livetvprogram', 'recording', 'timer', 'seriestimer', 'tvprogram'])
export const isLiveType = (type: unknown) => typeof type === 'string' && LIVE_TYPES.has(type.toLowerCase())

export function ageAllowed(age: number | null, type: string, limit: Limit): boolean {
  if (isLiveType(type)) return false
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

function decodeAll(s: string): string {
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
  return t
}
const flatIds = (t: string) => t.toLowerCase().replace(HYPHENATED, (m) => m.replace(/-/g, ''))
/** A user's or a session's id in a path ("/Users/<id>/…", "/Sessions/<id>/…"): not a title. */
const NOT_TITLE = /\/(users|sessions)\/+[0-9a-f]{32}(?=\/|$)/g

/** Every item id a Jellyfin request names: in its path (decoded, any case, hyphenated or not) and its id parameters. */
export function idsIn(path: string, query: URLSearchParams, opts: { skipPeople?: boolean } = {}): string[] {
  const out = new Set<string>()
  const scan = (s: string, isPath = false) => {
    let t = flatIds(decodeAll(s))
    if (isPath && opts.skipPeople) t = t.replace(NOT_TITLE, '/$1/')
    for (const m of t.match(HEX) ?? []) out.add(m)
  }
  scan(path, true)
  for (const [k, v] of query) if (ID_KEYS.has(k.toLowerCase())) scan(v)
  return [...out]
}

/**
 * Why a limited profile's request is refused before any title is looked up: Live TV (no ratings
 * Finesse can check), or an id written in a form Finesse doesn't read (Jellyfin also parses
 * "{0x…,…}", "{…}" and "(…)" GUIDs).
 */
export function refusedShape(path: string, query: URLSearchParams): string | null {
  const p = decodeAll(path).toLowerCase()
  if (/(^|\/)livetv(\/|$)/.test(p)) return 'Live TV is off for this profile'
  const odd = (s: string) => /\{\s*0x/i.test(s) || /[{(]\s*[0-9a-f]{8}-?[0-9a-f]{4}/i.test(s)
  if (odd(p)) return 'That address isn’t allowed'
  for (const [k, v] of query) if (ID_KEYS.has(k.toLowerCase()) && (/[{}()]/.test(decodeAll(v)) || odd(decodeAll(v)))) return 'That address isn’t allowed'
  return null
}

/** Keys that name the item an object is, or the title it belongs to (any case). */
const REF_KEYS = new Set(['id', 'itemid', 'seriesid', 'seasonid', 'albumid', 'channelid', 'categoryid', 'nowplayingitemid', 'parentbackdropitemid', 'parentthumbitemid', 'parentlogoitemid', 'parentprimaryimageitemid', 'ownerid'])
/** Lists whose count is TotalRecordCount. */
const LIST_KEYS = new Set(['items', 'searchhints'])

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

  /**
   * A request for Jellyfin (the /jellyfin proxy, its WebSocket): the one token Jellyfin would use,
   * whose it is (one lookup), and the request rebuilt to carry only that token. Null when no
   * profile is limited (requests pass as they are). Unreadable sign-ins are refused.
   */
  async jellyfinCaller(req: IncomingMessage, search: string): Promise<{ kid: { id: string; limit: Limit } | null; upstream: { headers: Record<string, string | null>; search: string } } | null> {
    if (!this.any()) return null
    const a = jellyfinAuth(req, new URLSearchParams(search))
    if (a.bad) throw new ApiError(400, `${a.bad}. Sign in again.`)
    let kid: { id: string; limit: Limit } | null = null
    if (a.token) {
      const u = await this.auth.userFor(a.token)
      const l = u ? this.limitOf(u.Id) : null
      if (u && l) kid = { id: u.Id.toLowerCase(), limit: l }
    }
    return { kid, upstream: soleToken(a, search) }
  }

  /**
   * What we know of items (type and age), read with the server's key in batches, kept 10 minutes
   * (1 minute for ids that aren't there). Ids the list query doesn't return (Jellyfin leaves out
   * extras and alternate versions there) are read one by one. An item without a rating takes its
   * show's (episodes, seasons) or its owner's (extras).
   */
  async describe(ids: string[], depth = 0): Promise<Map<string, Known>> {
    const out = new Map<string, Known>()
    const now = Date.now()
    const need: string[] = []
    for (const id of ids) {
      const k = this.known.get(id)
      if (k && now - k.at < (k.exists ? 10 * 60e3 : 60e3)) out.set(id, k)
      else need.push(id)
    }
    type Raw = { Id: string; Type?: string; OfficialRating?: string; CustomRating?: string; SeriesId?: string; OwnerId?: string; ParentId?: string; ExtraType?: string }
    const fields = 'Fields=CustomRating,OfficialRating,ParentId&EnableImages=false&EnableUserData=false'
    for (let i = 0; i < need.length; i += 100) {
      const batch = need.slice(i, i + 100)
      const r = await this.jf.request<{ Items?: Raw[] }>(`/Items?Ids=${batch.join(',')}&Recursive=true&${fields}&EnableTotalRecordCount=false`, { timeoutMs: 15000 })
      const found = new Map((r?.Items ?? []).map((it) => [String(it.Id).toLowerCase().replace(/-/g, ''), it]))
      // Extras and alternate versions: by id (up to 10 a request; the rest count as not there).
      const missing = batch.filter((id) => !found.has(id)).slice(0, 10)
      await Promise.all(
        missing.map((id) =>
          this.jf
            .request<Raw>(`/Items/${id}?${fields}`, { timeoutMs: 15000 })
            .then((it) => {
              if (it && String(it.Id).toLowerCase().replace(/-/g, '') === id) found.set(id, it)
            })
            .catch(() => {}),
        ),
      )
      const own = (it: Raw) => ratingAge(it.CustomRating || it.OfficialRating)
      const upOf = (it: Raw): string | null => {
        const up = it.SeriesId || it.OwnerId || (it.ExtraType && it.ParentId) || null
        const u = up ? String(up).toLowerCase().replace(/-/g, '') : null
        return u && /^[0-9a-f]{32}$/.test(u) ? u : null
      }
      const ups = [...new Set([...found.values()].filter((it) => own(it) === null).map(upOf).filter((u): u is string => !!u && !found.has(u)))]
      const upAges = ups.length && depth < 2 ? await this.describe(ups, depth + 1) : new Map<string, Known>()
      for (const id of batch) {
        const it = found.get(id)
        let k: Known
        if (!it) k = { exists: false, type: '', age: null, at: now }
        else {
          let age = own(it)
          const up = age === null ? upOf(it) : null
          if (up) age = found.has(up) ? own(found.get(up)!) : (upAges.get(up)?.age ?? null)
          k = { exists: true, type: String(it.Type ?? ''), age, at: now }
        }
        if (this.known.size > 50000) this.known.clear()
        this.known.set(id, k)
        out.set(id, k)
      }
    }
    return out
  }

  /** Whether these ids are all fine for this limit. An id that isn't an item Finesse can find is refused, and so is everything when the read fails. */
  async allowsAll(limit: Limit, ids: string[]): Promise<boolean> {
    if (!ids.length) return true
    const known = await this.describe(ids)
    return ids.every((id) => {
      const k = known.get(id)
      return !!k && k.exists && ageAllowed(k.age, k.type, limit)
    })
  }

  /** Whether one of our people may open this title of ours. */
  async allows(userId: string, raw: string): Promise<boolean> {
    const l = this.limitOf(userId)
    if (!l) return true
    return this.allowsAll(l, [raw.toLowerCase()]).catch(() => false)
  }

  /**
   * A JSON reply for a limited profile, with what it can't open taken out, however deep and
   * whatever the case of its keys (Items/items, Id/id, ItemId, SeriesId, NowPlayingItem…): an
   * object that is or points to a blocked title goes (from a list, or as a property); a wrapper
   * whose list emptied because of it goes too (/Movies/Recommendations' "Because you watched…").
   * A reply that can't be read isn't sent on at all.
   */
  async filterJson(text: string, limit: Limit): Promise<string> {
    if (!text.trim()) return text
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('not JSON')
    }
    const ids = new Set<string>()
    const asId = (v: unknown) => {
      const id = typeof v === 'string' ? v.toLowerCase().replace(/-/g, '') : ''
      return /^[0-9a-f]{32}$/.test(id) ? id : null
    }
    const refsOf = (o: Record<string, unknown>) => {
      const out: string[] = []
      for (const [k, v] of Object.entries(o)) if (REF_KEYS.has(k.toLowerCase())) {
        const id = asId(v)
        if (id) out.push(id)
      }
      return out
    }
    const collect = (x: unknown, depth: number) => {
      if (depth > 64) throw new Error('too deep')
      if (Array.isArray(x)) for (const v of x) collect(v, depth + 1)
      else if (x && typeof x === 'object') {
        for (const id of refsOf(x as Record<string, unknown>)) ids.add(id)
        for (const v of Object.values(x)) if (v && typeof v === 'object') collect(v, depth + 1)
      }
    }
    collect(data, 0)
    const known = ids.size ? await this.describe([...ids]) : new Map<string, Known>()
    const blocked = (x: unknown): boolean => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) return false
      const o = x as Record<string, unknown>
      const type = Object.entries(o).find(([k]) => k.toLowerCase() === 'type')?.[1]
      if (isLiveType(type)) return true
      const ct = Object.entries(o).find(([k]) => k.toLowerCase() === 'collectiontype')?.[1]
      if (typeof ct === 'string' && ct.toLowerCase() === 'livetv') return true
      return refsOf(o).some((id) => {
        const k = known.get(id)
        return !!k && k.exists && !ageAllowed(k.age, k.type, limit)
      })
    }
    // Returns false when the node itself must go.
    const clean = (x: unknown): boolean => {
      if (Array.isArray(x)) {
        for (let i = x.length - 1; i >= 0; i--) if (!clean(x[i])) x.splice(i, 1)
        return true
      }
      if (!x || typeof x !== 'object') return true
      if (blocked(x)) return false
      const o = x as Record<string, unknown>
      for (const [k, v] of Object.entries(o)) {
        if (!v || typeof v !== 'object') continue
        const before = Array.isArray(v) ? v.length : 0
        if (!clean(v)) {
          delete o[k]
          continue
        }
        if (Array.isArray(v)) {
          const gone = before - v.length
          if (gone && LIST_KEYS.has(k.toLowerCase())) {
            for (const [ck, cv] of Object.entries(o)) if (ck.toLowerCase() === 'totalrecordcount' && typeof cv === 'number') o[ck] = Math.max(0, cv - gone)
            // A wrapper ("Because you watched…") whose list is now empty goes too.
            if (!v.length && Object.keys(o).some((ok) => ok.toLowerCase() === 'baselineitemname')) return false
          }
        }
      }
      return true
    }
    if (!clean(data)) throw new Error('blocked')
    return JSON.stringify(data)
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

// ---------- which token Jellyfin would use ----------
//
// Jellyfin (Jellyfin.Server.Implementations/Security/AuthorizationContext.cs) takes ONE token, in
// this order: the Token field of the Authorization header ("MediaBrowser" or, legacy, "Emby"
// scheme; X-Emby-Authorization when there's no Authorization header), then X-Emby-Token, then
// X-MediaBrowser-Token, then the ApiKey query key, then api_key (query keys any case). Header
// fields are split on commas outside quotes, quotes trimmed, and URL-decoded (WebUtility.UrlDecode).
// Finesse resolves the same one token, looks up whose it is once, and (when any limits exist)
// rebuilds the request so it carries only that token: what Finesse checked is what Jellyfin sees.

/** WebUtility.UrlDecode: '+' is a space, %XX a byte; anything malformed stays as it is. */
export function urlDecodeLenient(s: string): string {
  if (!/[%+]/.test(s)) return s
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '+') bytes.push(0x20)
    else if (c === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16))
      i += 2
    } else for (const b of Buffer.from(c, 'utf8')) bytes.push(b)
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * A "MediaBrowser …" (or "Emby …") header's fields, parsed as Jellyfin's GetParts does. Null when
 * Jellyfin wouldn't read it (another scheme, no space). `odd`: its quotes don't pair up.
 */
export function parseAuthHeader(header: string): { fields: [string, string][]; odd: boolean } | null {
  const sp = header.indexOf(' ')
  if (sp === -1) return null
  if (!/^(mediabrowser|emby)$/i.test(header.slice(0, sp))) return null
  const s = header.slice(sp + 1)
  const fields: [string, string][] = []
  const trimQuotes = (v: string) => v.replace(/^"+|"+$/g, '')
  let escaped = false
  let start = 0
  let key = ''
  let quotes = 0
  let i = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === ',') {
      if (c === '"') {
        escaped = !escaped
        quotes++
      }
      if (c === ',' && !escaped) {
        if (start < i) {
          fields.push([key, urlDecodeLenient(trimQuotes(s.slice(start, i)))])
          key = ''
        }
        start = i + 1
      }
    } else if (!escaped && c === '=') {
      key = s.slice(start, i).trim()
      start = i + 1
    }
  }
  if (start < i) fields.push([key, urlDecodeLenient(trimQuotes(s.slice(start, i)))])
  return { fields, odd: quotes % 2 === 1 }
}

export interface JellyfinAuth {
  /** The one token Jellyfin would use (null: none). */
  token: string | null
  /** Every distinct token the request carries, anywhere Jellyfin looks. */
  all: string[]
  /** The Authorization header's other fields (Client, Device, DeviceId, Version), to send on. */
  fields: [string, string][]
  /** The token rode in the query too (a <video> or WebSocket address): it's put back there. */
  inQuery: boolean
  /** Why the request can't be read safely (refused when limits exist). */
  bad: string | null
}

const QUERY_TOKEN = /^(apikey|api_key)$/i
const MAX_TOKENS = 3

/** The token Jellyfin would take from this request, in Jellyfin's order. */
export function jellyfinAuth(req: IncomingMessage, query: URLSearchParams = new URLSearchParams()): JellyfinAuth {
  const h = req.headers
  const all = new Set<string>()
  let bad: string | null = null
  let fields: [string, string][] = []
  let fromHeader: string | null = null
  const str = (v: unknown) => (Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : '')
  for (const name of ['authorization', 'x-emby-authorization'] as const) {
    const v = str(h[name])
    if (!v.trim()) continue
    const parsed = parseAuthHeader(v.trim())
    if (!parsed || parsed.odd) {
      bad = 'That sign-in header isn’t one Finesse can read'
      continue
    }
    const toks = parsed.fields.filter(([k]) => k.toLowerCase() === 'token').map(([, t]) => t).filter(Boolean)
    for (const t of toks) all.add(t)
    // Jellyfin reads X-Emby-Authorization only when there's no Authorization header.
    if (name === 'authorization' || !str(h.authorization).trim()) {
      if (fromHeader === null && toks.length) fromHeader = toks.at(-1)!
      if (!fields.length) fields = parsed.fields.filter(([k]) => k.toLowerCase() !== 'token' && /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(k))
    }
  }
  const emby = str(h['x-emby-token'])
  const mb = str(h['x-mediabrowser-token'])
  for (const t of [emby, mb]) if (t) all.add(t)
  const q = (want: string) => {
    for (const [k, v] of query) if (k.toLowerCase() === want && v) return v
    return ''
  }
  let inQuery = false
  for (const [k, v] of query) {
    if (!QUERY_TOKEN.test(k)) continue
    inQuery = true
    if (v) all.add(v)
  }
  const token = fromHeader || emby || mb || q('apikey') || q('api_key') || null
  if (all.size > MAX_TOKENS) bad = 'That request carries too many sign-ins'
  return { token, all: [...all], fields, inQuery, bad }
}

/** The request as Jellyfin should get it: only the one token, in an Authorization header (and the query, if it was there). */
export function soleToken(a: JellyfinAuth, search: string): { headers: Record<string, string | null>; search: string } {
  const enc = (v: string) => encodeURIComponent(v)
  const parts = a.fields.map(([k, v]) => `${k}="${enc(v)}"`)
  if (a.token) parts.push(`Token="${enc(a.token)}"`)
  const q = new URLSearchParams(search)
  for (const k of [...new Set(q.keys())]) if (QUERY_TOKEN.test(k)) q.delete(k)
  if (a.inQuery && a.token) {
    q.set('ApiKey', a.token)
    q.set('api_key', a.token)
  }
  const s = q.toString()
  return {
    headers: { authorization: parts.length ? `MediaBrowser ${parts.join(', ')}` : null, 'x-emby-authorization': null, 'x-emby-token': null, 'x-mediabrowser-token': null },
    search: s ? `?${s}` : '',
  }
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
