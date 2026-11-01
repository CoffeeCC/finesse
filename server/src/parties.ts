// Watch parties: people on this server playing one title together, in step (src/lib/partySync.ts
// has the rules). Someone starts one from a title and invites people here; each invited person
// joins from their own device, and only if their own profile can open the title (checked for
// each person, limits included, not taken from the host). Players report in about once a second
// and get the party's clock back.
//
// Parties live in memory: a restart ends them (players carry on alone and say so). Titles on
// this server only for now: Finesse can't check a friend's title for each person here.

import { randomBytes } from 'node:crypto'
import { groupUserIds, type Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { RAW_ID, type Access } from './access.ts'
import { logger } from './log.ts'
import { control, join, leave, MAX_MEMBERS, positionAt, report, tick, waitingFor, type Party } from '../../src/lib/partySync.ts'

const log = logger('parties')
const KEEP_MS = 12 * 3600e3
/** Parties going at once: each person hosts up to this many, the server holds up to ALL. */
export const PARTY_LIMITS = { perHost: 3, all: 50 }
/** What an invitation or a party says to someone who can't open its title. */
const HIDDEN_TITLE = 'A title you can’t open'

export function registerParties(router: Router, deps: { auth: Auth; settings: SettingsStore; access: Access; now?: () => number }) {
  const { auth, settings, access } = deps
  const now = deps.now ?? Date.now
  const parties = new Map<string, Party>()

  const sweep = () => {
    const t = now()
    for (const [id, p] of parties) {
      if (p.members.length) tick(p, t)
      // Nobody came within 10 minutes, everyone left, or it's been going for half a day.
      if (p.ended || (!p.members.length && t - p.created > 10 * 60e3) || t - p.created > KEEP_MS) parties.delete(id)
    }
  }
  setInterval(sweep, 2000).unref()

  /** A party the person is invited to or in; anything else is "not found". */
  const find = (id: string, me: string): Party => {
    const p = parties.get(id)
    if (!p || p.ended || !(p.invited.includes(me) || p.members.some((m) => m.id === me))) throw new ApiError(404, 'That watch party is over, or you’re not invited')
    return p
  }
  const member = (p: Party, me: string) => {
    if (!p.members.some((m) => m.id === me)) throw new ApiError(409, 'Join the party first')
  }

  /** The title as this person may see it: theirs to open, or nothing about it (their access can change after the invitation). */
  const titleSeen = async (p: Party, me: string) => ((await access.mayOpen(me, p.item)) ? { item: p.item as string | null, title: p.title } : { item: null, title: HIDDEN_TITLE })

  const view = async (p: Party, me: string) => {
    const t = now()
    tick(p, t)
    const names = new Map(p.members.map((m) => [m.id, m.name]))
    return {
      id: p.id,
      ...(await titleSeen(p, me)),
      host: { id: p.host, name: names.get(p.host) ?? 'Someone' },
      isHost: p.host === me,
      joined: p.members.some((m) => m.id === me),
      ended: p.ended,
      clock: { ...p.clock, position: positionAt(p.clock, t), at: t },
      serverNow: t,
      waitingFor: waitingFor(p, t).map((m) => m.name),
      members: p.members.map((m) => ({ id: m.id, name: m.name, inStep: m.synced && m.bufferingSince === null && Math.abs(m.position - positionAt(p.clock, t)) <= 3, buffering: m.bufferingSince !== null })),
      max: MAX_MEMBERS,
    }
  }

  router.post('/api/parties', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    const body = await readJson<{ item?: unknown; invite?: unknown; position?: unknown }>(req)
    const item = String(body.item ?? '').toLowerCase()
    if (!RAW_ID.test(item)) throw new ApiError(400, 'Watch parties work with titles on this server for now')
    const t = await access.titleFor({ id: me.id, name: me.Name }, item)
    if (!t) throw new ApiError(404, 'You can’t open that title')
    if (!['Movie', 'Episode', 'Video'].includes(t.type)) throw new ApiError(400, 'Pick a film or an episode to watch together')
    const viewers = new Set([...groupUserIds(settings.get())].map((u) => u.toLowerCase()))
    const people = await access.people(viewers)
    const ok = new Set(people.map((x) => x.id))
    const invited = Array.isArray(body.invite) ? [...new Set(body.invite.map((x) => String(x).toLowerCase()).filter((x) => ok.has(x) && x !== me.id))] : []
    if (!invited.length) throw new ApiError(400, 'Invite at least one person')
    if (invited.length + 1 > MAX_MEMBERS) throw new ApiError(400, `A watch party is up to ${MAX_MEMBERS} people`)
    sweep()
    const going = [...parties.values()].filter((x) => !x.ended)
    if (going.filter((x) => x.host === me.id).length >= PARTY_LIMITS.perHost) throw new ApiError(429, `You have ${PARTY_LIMITS.perHost} watch parties going. End one first.`)
    if (going.length >= PARTY_LIMITS.all) throw new ApiError(503, 'There are too many watch parties going on this server right now. Try again later.')
    // An invitation names the title: only to people who can open it.
    const cant: string[] = []
    for (const u of invited) if (!(await access.mayOpen(u, item))) cant.push(people.find((x) => x.id === u)?.name ?? 'Someone')
    if (cant.length) throw new ApiError(400, `${cant.join(', ')} can’t open this title, so they can’t be invited`)
    const at = Number(body.position)
    const p: Party = {
      id: randomBytes(9).toString('base64url'),
      item,
      title: [t.title, t.subtitle].filter(Boolean).join(' · '),
      host: me.id,
      // The host too, so they can come back after a dropped connection.
      invited: [me.id, ...invited],
      members: [],
      clock: { playing: false, position: Number.isFinite(at) && at > 0 ? at : 0, at: now(), waiting: false, rev: 0 },
      created: now(),
      ended: false,
    }
    join(p, { id: me.id, name: me.Name }, now())
    parties.set(p.id, p)
    log.info(`${me.Name} started a watch party for ${invited.length + 1}`)
    sendJson(res, 201, await view(p, me.id))
  })

  // Parties you're invited to or in (the app's invitations).
  router.get('/api/parties', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    sweep()
    const mine = [...parties.values()].filter((p) => !p.ended && (p.invited.includes(me.id) || p.members.some((m) => m.id === me.id)))
    const out = await Promise.all(mine.map(async (p) => ({ id: p.id, ...(await titleSeen(p, me.id)), host: p.members.find((m) => m.id === p.host)?.name ?? 'Someone', people: p.members.length, joined: p.members.some((m) => m.id === me.id) })))
    sendJson(res, 200, { parties: out })
  })

  router.get('/api/parties/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    sendJson(res, 200, await view(find(String(params.id), me.id), me.id))
  })

  router.post('/api/parties/:id/join', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const p = find(String(params.id), me.id)
    // Checked for this person: being invited doesn't make a title watchable.
    if (!(await access.mayOpen(me.id, p.item))) throw new ApiError(403, 'Your profile can’t open this title, so you can’t join this party')
    if (!p.members.some((m) => m.id === me.id) && p.members.length >= MAX_MEMBERS) throw new ApiError(400, `This party is full (${MAX_MEMBERS} people)`)
    join(p, { id: me.id, name: me.Name }, now())
    sendJson(res, 200, await view(p, me.id))
  })

  // A player reporting in: where it is and whether it's stalled. The party's clock comes back.
  router.post('/api/parties/:id/beat', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const p = find(String(params.id), me.id)
    member(p, me.id)
    const body = await readJson<{ position?: unknown; buffering?: unknown }>(req)
    const position = Number(body.position)
    if (!Number.isFinite(position) || position < 0) throw new ApiError(400, 'Where is it?')
    report(p, me.id, { position, buffering: body.buffering === true }, now())
    sendJson(res, 200, await view(p, me.id))
  })

  router.post('/api/parties/:id/control', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const p = find(String(params.id), me.id)
    member(p, me.id)
    const body = await readJson<{ action?: unknown; position?: unknown }>(req)
    const position = Number(body.position)
    if (body.action === 'play' || body.action === 'pause') control(p, { action: body.action }, now())
    else if (body.action === 'seek' && Number.isFinite(position) && position >= 0 && position < 24 * 3600) control(p, { action: 'seek', position }, now())
    else throw new ApiError(400, 'Play, pause or seek')
    sendJson(res, 200, await view(p, me.id))
  })

  router.post('/api/parties/:id/leave', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const p = parties.get(String(params.id))
    if (p) {
      leave(p, me.id)
      if (p.ended) parties.delete(p.id)
    }
    sendJson(res, 200, { ok: true })
  })

  // The host ends it for everyone.
  router.delete('/api/parties/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const p = find(String(params.id), me.id)
    if (p.host !== me.id) throw new ApiError(403, 'Only the host can end the party')
    p.ended = true
    parties.delete(p.id)
    sendJson(res, 200, { ok: true })
  })

  return { parties }
}
