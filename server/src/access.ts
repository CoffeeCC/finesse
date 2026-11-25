// Which titles one of our people can open, asked of Jellyfin for that person (their library
// access and limits apply), and what a title is called. Used wherever Finesse itself hands
// out title references with the server's own key (shared queues, Moments collections,
// watch parties), so nothing reaches someone who couldn't open it in the app.
//
// Ids: a title of ours is its Jellyfin id (32 hex). A friend's (Groups) is "f-<friend>-<id>".

import type { GroupFriend, SettingsStore } from './config.ts'
import type { Jellyfin } from './jellyfin.ts'
import type { GroupsApi } from './moments.ts'

export const RAW_ID = /^[0-9a-f]{32}$/
export const FRIEND_ID = /^f-([a-z0-9]{8})-([0-9a-f]{32})$/

export interface TitleInfo {
  title: string
  subtitle: string
  type: string
}

interface JfLite {
  Id: string
  Name?: string
  Type?: string
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  ProductionYear?: number
}

export function titleOf(it: JfLite): TitleInfo {
  const episode = it.Type === 'Episode'
  return {
    title: String((episode ? it.SeriesName || it.Name : it.Name) || 'A title').slice(0, 200),
    subtitle: episode
      ? [it.ParentIndexNumber != null && it.IndexNumber != null ? `S${it.ParentIndexNumber}:E${it.IndexNumber}` : null, it.Name].filter(Boolean).join(' · ').slice(0, 200)
      : it.ProductionYear
        ? String(it.ProductionYear)
        : '',
    type: String(it.Type ?? ''),
  }
}

/** "f-1a2b3c4d-<id>" → the friend and their id; null for ours (or anything else). */
export function friendPart(id: string): { friend: string; raw: string } | null {
  const m = FRIEND_ID.exec(id)
  return m ? { friend: m[1]!, raw: m[2]! } : null
}

export type Availability = 'yes' | 'no' | 'unknown'

export class Access {
  private jf: Jellyfin
  private groups: GroupsApi
  private seen = new Map<string, { at: number; yes: boolean }>()
  private titles = new Map<string, { at: number; title: TitleInfo | null }>()
  private peopleCache: { at: number; users: { Id: string; Name: string; Policy?: { IsDisabled?: boolean } }[] } | null = null
  /** Extra say over a person's access (parental limits); set once the limits are loaded. */
  limited: (userId: string) => boolean = () => false
  ratingAllows: (userId: string, raw: string) => Promise<boolean> = async () => true

  constructor(deps: { jf: Jellyfin; groups: GroupsApi; settings: SettingsStore }) {
    this.jf = deps.jf
    this.groups = deps.groups
  }

  private rememberSeen(key: string, yes: boolean, now = Date.now()) {
    this.seen.delete(key)
    if (this.seen.size >= 20000) {
      const oldest = this.seen.keys().next()
      if (!oldest.done) this.seen.delete(oldest.value)
    }
    this.seen.set(key, { at: now, yes })
  }

  friend(id: string): GroupFriend | undefined {
    return this.groups.friends().find((f) => f.id === id)
  }

  /** Whether one of our people can open a title of ours: asked of Jellyfin as them (cached 2 minutes). */
  async canOpenOurs(userId: string, raw: string): Promise<boolean> {
    const key = `${userId}/${raw}`
    const hit = this.seen.get(key)
    let yes: boolean
    if (hit && Date.now() - hit.at < 120e3) yes = hit.yes
    else {
      const r = await this.jf
        .request<{ Items?: { Id: string }[] }>(`/Users/${userId}/Items?Ids=${raw}&Recursive=true&Limit=1&EnableImages=false&EnableUserData=false`, { timeoutMs: 15000 })
        .catch(() => null)
      if (r === null) return false
      yes = Boolean(r.Items?.some((i) => String(i.Id).toLowerCase() === raw))
      this.rememberSeen(key, yes)
    }
    return yes && (await this.ratingAllows(userId, raw))
  }

  /**
   * Batched availability for one user across many title ids: one Jellyfin query per chunk of
   * uncached local ids instead of one request per title (turns 20×100 = 2,000 calls into ≤40).
   */
  async availabilityMany(userId: string, ids: string[]): Promise<Map<string, Availability>> {
    const out = new Map<string, Availability>()
    const now = Date.now()
    const missingRaw: string[] = []
    const checkRating: string[] = []
    const uniq = [...new Set(ids)]
    for (const id of uniq) {
      const fp = friendPart(id)
      if (fp) {
        out.set(id, !this.friend(fp.friend) || this.limited(userId) ? 'no' : 'unknown')
        continue
      }
      if (!RAW_ID.test(id)) {
        out.set(id, 'no')
        continue
      }
      const hit = this.seen.get(`${userId}/${id}`)
      if (hit && now - hit.at < 120e3) {
        if (hit.yes) checkRating.push(id)
        else out.set(id, 'no')
      } else {
        missingRaw.push(id)
      }
    }
    const CHUNK = 50
    for (let i = 0; i < missingRaw.length; i += CHUNK) {
      const slice = missingRaw.slice(i, i + CHUNK)
      const r = await this.jf
        .request<{ Items?: { Id: string }[] }>(
          `/Users/${userId}/Items?Ids=${slice.join(',')}&Recursive=true&Limit=${slice.length}&EnableImages=false&EnableUserData=false`,
          { timeoutMs: 15000 },
        )
        .catch(() => null)
      if (r === null) {
        for (const raw of slice) out.set(raw, 'no')
        continue
      }
      const found = new Set((r.Items ?? []).map((it) => String(it.Id).toLowerCase()))
      const at = Date.now()
      for (const raw of slice) {
        const yes = found.has(raw)
        this.rememberSeen(`${userId}/${raw}`, yes, at)
        if (yes) checkRating.push(raw)
        else out.set(raw, 'no')
      }
    }
    if (checkRating.length) {
      const allowed = await Promise.all(checkRating.map((raw) => this.ratingAllows(userId, raw)))
      for (let i = 0; i < checkRating.length; i++) {
        out.set(checkRating[i]!, allowed[i] ? 'yes' : 'no')
      }
    }
    return out
  }

  /**
   * Whether one of our people can open a title: ours is checked for them; a friend's is "unknown"
   * (everyone here reaches a friend's shared libraries the same way, but Finesse can't confirm the
   * title for each person without asking that server as them), or "no" when the friend is gone or
   * the person's profile is limited (limited profiles don't reach friends' servers).
   */
  async availability(userId: string, id: string): Promise<Availability> {
    const fp = friendPart(id)
    if (fp) return !this.friend(fp.friend) || this.limited(userId) ? 'no' : 'unknown'
    if (!RAW_ID.test(id)) return 'no'
    return (await this.canOpenOurs(userId, id)) ? 'yes' : 'no'
  }

  /** Whether a person may see a title's name and open it: yes for ours they can open, and for a friend's when they may reach friends. */
  async mayOpen(userId: string, id: string): Promise<boolean> {
    return (await this.availability(userId, id)) !== 'no'
  }

  /** What a title is called, read as the person adding it (so it's also proof they can open it). Null when they can't. Kept 2 minutes. */
  async titleFor(user: { id: string; name: string }, id: string): Promise<TitleInfo | null> {
    const key = `${user.id}/${id}`
    const hit = this.titles.get(key)
    if (hit && Date.now() - hit.at < 120e3) return hit.title
    const title = await this.readTitle(user, id)
    if (this.titles.size > 5000) this.titles.clear()
    this.titles.set(key, { at: Date.now(), title })
    return title
  }

  private async readTitle(user: { id: string; name: string }, id: string): Promise<TitleInfo | null> {
    const fp = friendPart(id)
    if (fp) {
      const f = this.friend(fp.friend)
      if (!f || this.limited(user.id)) return null
      const r = await this.groups.friendJellyfin<{ Items?: JfLite[] }>(f, user, `Users/x/Items?Ids=${fp.raw}&Recursive=true&Fields=ProductionYear&EnableImages=false`).catch(() => null)
      const it = r?.Items?.find((i) => String(i.Id).toLowerCase() === fp.raw)
      return it ? titleOf(it) : null
    }
    if (!RAW_ID.test(id)) return null
    if (!(await this.canOpenOurs(user.id, id))) return null
    const r = await this.jf.request<{ Items?: JfLite[] }>(`/Users/${user.id}/Items?Ids=${id}&Recursive=true&Fields=ProductionYear&EnableImages=false`).catch(() => null)
    const it = r?.Items?.find((i) => String(i.Id).toLowerCase() === id)
    return it ? titleOf(it) : null
  }

  /** People on this server: not friends' viewer accounts, not disabled ones (cached 60s). */
  async people(viewers: Set<string>): Promise<{ id: string; name: string }[]> {
    const now = Date.now()
    let users: { Id: string; Name: string; Policy?: { IsDisabled?: boolean } }[]
    if (this.peopleCache && now - this.peopleCache.at < 60_000) {
      users = this.peopleCache.users
    } else {
      const res = await this.jf.request<{ Id: string; Name: string; Policy?: { IsDisabled?: boolean } }[]>('/Users').catch(() => null)
      if (Array.isArray(res)) {
        users = res
        this.peopleCache = { at: now, users }
      } else {
        users = this.peopleCache?.users ?? []
      }
    }
    return users
      .filter((u) => !viewers.has(u.Id) && !u.Policy?.IsDisabled && RAW_ID.test(String(u.Id).toLowerCase()))
      .map((u) => ({ id: String(u.Id).toLowerCase(), name: u.Name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}
