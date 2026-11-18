// Casting to a Roku. The Jellyfin Roku app shows up in Jellyfin's sessions but can't be
// remote-controlled through Jellyfin (it reports no commands), so "Play on…" never listed it.
// The Roku itself can be told what to do over the home network (Roku's External Control
// Protocol, port 8060), and the Jellyfin app plays an item it's launched with
// (contentId + mediaType, its deep links). So Finesse does it: the app's cast menu lists the
// Roku with the other screens, and picking it lands here. Only a session the person may
// control, only an address on the home network that answers as a Roku, and only a title the
// person can see.

import type { Auth } from './auth.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import type { Jellyfin, JfUser } from './jellyfin.ts'

/** The Jellyfin channel's id in the Roku Channel Store. */
export const JELLYFIN_CHANNEL = '592369'

interface Session {
  Id: string
  UserId?: string
  Client?: string
  DeviceName?: string
  RemoteEndPoint?: string
  SupportsRemoteControl?: boolean
  PlayState?: { IsPaused?: boolean }
  NowPlayingItem?: unknown
}

/** A Jellyfin Roku session: a Roku app that Jellyfin itself can't drive. */
export const isRokuSession = (s: Session) => /roku/i.test(s.Client ?? '') && !s.SupportsRemoteControl

/** "192.168.8.121", "::ffff:192.168.8.121" or "192.168.8.121:51234" → the address, if it's on a home network. */
export function homeAddress(endpoint: string | undefined): string | null {
  const ip = (endpoint ?? '').trim().replace(/^::ffff:/i, '').replace(/:\d+$/, '')
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const [a, b] = [Number(m[1]), Number(m[2])]
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return null
  const home = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  return home ? ip : null
}

/** Jellyfin item types → the Jellyfin Roku app's deep-link media types. */
const MEDIA_TYPE: Record<string, string> = {
  Movie: 'movie',
  Episode: 'episode',
  Video: 'video',
  Recording: 'recording',
  Series: 'series',
  Audio: 'audio',
  AudioBook: 'audiobook',
  MusicAlbum: 'musicalbum',
  MusicArtist: 'musicartist',
}

/** What the mini remote's buttons send, as the Roku remote's keys. */
const KEYS: Record<string, string> = { PlayPause: 'Play', Pause: 'Play', Unpause: 'Play', Stop: 'Back', NextTrack: 'Fwd', PreviousTrack: 'Rev' }

export type Ecp = (ip: string, method: 'GET' | 'POST', path: string) => Promise<{ status: number; text: string }>

const liveEcp: Ecp = async (ip, method, path) => {
  const r = await fetch(`http://${ip}:8060${path}`, { method, signal: AbortSignal.timeout(4000) })
  return { status: r.status, text: await r.text() }
}

export class Roku {
  private jf: Jellyfin
  private ecp: Ecp
  /** Addresses that answered as a Roku lately (true) or didn't (false), so the cast menu stays quick. */
  private seen = new Map<string, { ok: boolean; at: number }>()

  constructor(jf: Jellyfin, ecp: Ecp = liveEcp) {
    this.jf = jf
    this.ecp = ecp
  }

  private async isRoku(ip: string): Promise<boolean> {
    const hit = this.seen.get(ip)
    if (hit && Date.now() - hit.at < (hit.ok ? 5 * 60_000 : 30_000)) return hit.ok
    let ok = false
    try {
      const r = await this.ecp(ip, 'GET', '/query/device-info')
      ok = r.status === 200 && /<device-info>/.test(r.text)
    } catch {
      ok = false
    }
    this.seen.set(ip, { ok, at: Date.now() })
    return ok
  }

  private mayControl = (user: JfUser, s: Session) => user.Policy?.IsAdministrator === true || (s.UserId ?? '').toLowerCase() === user.Id.toLowerCase()

  /** The Roku sessions this person may cast to that Finesse can reach. */
  async targets(user: JfUser): Promise<string[]> {
    const sessions = await this.jf.request<Session[]>('/Sessions?ActiveWithinSeconds=900')
    const out: string[] = []
    await Promise.all(
      sessions.filter((s) => isRokuSession(s) && this.mayControl(user, s)).map(async (s) => {
        const ip = homeAddress(s.RemoteEndPoint)
        if (ip && (await this.isRoku(ip))) out.push(s.Id)
      }),
    )
    return out
  }

  private async reach(user: JfUser, sessionId: string): Promise<{ s: Session; ip: string }> {
    const sessions = await this.jf.request<Session[]>('/Sessions?ActiveWithinSeconds=900')
    const s = sessions.find((x) => x.Id === sessionId)
    if (!s || !isRokuSession(s)) throw new ApiError(404, 'That TV isn’t on any more. Open Jellyfin on it, then try again.')
    if (!this.mayControl(user, s)) throw new ApiError(403, 'That TV is signed in to someone else’s account.')
    const ip = homeAddress(s.RemoteEndPoint)
    if (!ip || !(await this.isRoku(ip))) throw new ApiError(502, `Finesse can’t reach ${s.DeviceName ?? 'the Roku'} on your network. Make sure it’s on the same network as the server.`)
    return { s, ip }
  }

  /** Plays a title on the Roku (the Jellyfin app opens it, or switches to it if it's already open). */
  async play(user: JfUser, sessionId: string, itemId: string) {
    if (!/^[0-9a-f]{32}$/i.test(itemId)) throw new ApiError(400, 'Only titles on this server can play on a Roku.')
    const { s, ip } = await this.reach(user, sessionId)
    const found = await this.jf.request<{ Items?: { Id: string; Type?: string }[] }>(`/Items?ids=${itemId}&userId=${encodeURIComponent(user.Id)}`).catch(() => ({ Items: [] }))
    const item = found.Items?.[0]
    if (!item) throw new ApiError(404, 'That title isn’t available to you.')
    const mediaType = MEDIA_TYPE[item.Type ?? '']
    if (!mediaType) throw new ApiError(400, 'The Roku can’t play this kind of item from here. Open it on the TV instead.')
    const r = await this.ecp(ip, 'POST', `/launch/${JELLYFIN_CHANNEL}?contentId=${itemId}&mediaType=${mediaType}`).catch(() => ({ status: 0, text: '' }))
    if (r.status === 403) throw new ApiError(502, `${s.DeviceName ?? 'The Roku'} turned Finesse away. On the TV: Settings → System → Advanced system settings → Control by mobile apps → Network access → Default.`)
    if (r.status < 200 || r.status >= 300) throw new ApiError(502, `${s.DeviceName ?? 'The Roku'} didn’t take it. Make sure the Jellyfin app is installed on it, then try again.`)
  }

  /** The mini remote: play/pause, stop and skip as Roku remote keys. */
  async press(user: JfUser, sessionId: string, command: string) {
    const { s, ip } = await this.reach(user, sessionId)
    // One Play key toggles: don't turn "pause" into "play" when it's already paused.
    if ((command === 'Pause' && s.PlayState?.IsPaused) || (command === 'Unpause' && s.NowPlayingItem && !s.PlayState?.IsPaused)) return
    const key = KEYS[command]
    if (!key) throw new ApiError(400, 'A Roku can’t do that from here. Use its own remote.')
    await this.ecp(ip, 'POST', `/keypress/${key}`).catch(() => {
      throw new ApiError(502, `Couldn’t reach ${s.DeviceName ?? 'the Roku'}`)
    })
  }
}

export function registerRoku(router: Router, deps: { auth: Auth; roku: Roku }) {
  const { auth, roku } = deps
  router.get('/api/cast/roku', async ({ req, res }) => {
    const user = await auth.requireUser(req)
    sendJson(res, 200, { sessions: await roku.targets(user).catch(() => []) })
  })
  router.post('/api/cast/roku/:session/play', async ({ req, res, params }) => {
    const user = await auth.requireUser(req)
    const body = await readJson<{ itemId?: unknown }>(req)
    if (typeof body.itemId !== 'string') throw new ApiError(400, 'Which title?')
    await roku.play(user, params.session!, body.itemId)
    sendJson(res, 200, { ok: true })
  })
  router.post('/api/cast/roku/:session/command', async ({ req, res, params }) => {
    const user = await auth.requireUser(req)
    const body = await readJson<{ command?: unknown }>(req)
    if (typeof body.command !== 'string') throw new ApiError(400, 'Which button?')
    await roku.press(user, params.session!, body.command)
    sendJson(res, 200, { ok: true })
  })
}
