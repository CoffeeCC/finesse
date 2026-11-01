// Puts the graphics plan (graphics.ts) into effect on servers Finesse set up:
//   • Jellyfin's and Wolf's containers get their card (only Finesse's own,
//     finesse.managed=true containers, and only when the plan changes: the
//     card is part of their spec hash);
//   • Jellyfin's encoding settings are set through its API, only the keys
//     Finesse owns (graphics.ts OWNED_ENCODING), and only when they differ.
//     If someone changed them in Jellyfin since, Finesse leaves them alone
//     until the plan itself changes (a card added, gone, or chosen); a
//     Jellyfin with settings of its own before Finesse ever set them is left
//     alone too, with a one-click offer in Settings.
// Never flaps: a probe that didn't finish changes nothing, and a card in use
// stays until it fails three tests in a row (graphics.ts settleInventory).
// Never restarts an app mid-use: a change waits while anyone watches on
// Jellyfin or plays through Wolf, and is tried again each maintenance tick.
// Each app's plan is saved only once its container really has it; a failed
// change is tried again with backoff, and keeps the image the app runs now.
// Runs in the nightly maintenance, when Jellyfin or Wolf won't start (a card
// that vanished takes the app back to the processor rather than leaving it
// unable to start), and when an administrator picks a card.

import type { Settings, SettingsStore } from '../config.ts'
import { logger } from '../log.ts'
import { stackContext } from '../setup/apply.ts'
import { wolfCall } from '../streaming.ts'
import { CATALOG, containerName, wolfSocket } from './catalog.ts'
import { assignKey, encodingFor, mergeEncoding, planGraphics, planKey, settleInventory, type GraphicsPlan, type Inventory, type JellyfinPlan, type WolfPlan } from './graphics.ts'
import type { StackHost } from './host.ts'
import { Orchestrator } from './orchestrator.ts'
import { fixCard, fixSettings, jellyfinGraphicsCheck, visibleTo, type GraphicsCheck, type Visible } from '../graphicsHealth.ts'
import { findJellyfin } from './jellyfinContainer.ts'
import { selfContainer } from './selfupdate.ts'

const log = logger('graphics')

/** What the containers were built with, kept in settings.stack.graphics. */
export interface StoredGraphics {
  /** The plan wanted now, from the cards as last found (settled: see settleInventory). */
  plan: GraphicsPlan
  /** planKey(plan). */
  key: string
  at: string
  /** The cards as last found by a probe that finished (for Settings → Server → Graphics). */
  inventory?: Inventory
  /**
   * What each app's container was actually built with: saved only once its ensureService
   * succeeded (stackContext builds the containers from this, never from `plan`).
   */
  built?: { jellyfin?: JellyfinPlan; wolf?: WolfPlan }
  /** Failed tests in a row, per card (cardKey). */
  failures?: Record<string, number>
  /** Jellyfin's encoding settings as Finesse last set them. */
  applied?: Record<string, unknown>
  /** Something to say about Jellyfin's settings (changed by someone in Jellyfin…). */
  note?: string | null
  /** Jellyfin has settings of its own that Finesse left alone: Settings offers Finesse's in one click. */
  offer?: boolean
  /** Part of the plan isn't in effect yet: why, and when Finesse tries again (each maintenance tick from then). */
  pending?: { why: string; attempts: number; next: string } | null
}

/** What the containers run with: `built`, or, saved before there was such a thing, the plan itself. */
export function builtOf(g: StoredGraphics | undefined): { jellyfin?: JellyfinPlan; wolf?: WolfPlan } {
  if (!g) return {}
  return g.built ?? { jellyfin: g.plan.jellyfin, wolf: g.plan.wolf }
}

/** Wait before trying a failed change again: 5 minutes, doubling, at most 6 hours. */
export function retryDelay(attempts: number): number {
  return Math.min(5 * 60000 * 2 ** Math.max(0, attempts - 1), 6 * 3600e3)
}

export interface AdoptGraphics {
  inventory: Inventory | null
  check: GraphicsCheck | null
  jellyfin: { name: string; visible: Visible; encoding?: string } | null
  /** Why something couldn't be looked at. */
  reason?: string
}

export type JellyfinGet = (path: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; json: unknown }>

/** Jellyfin's API with Finesse's key. */
export function jellyfinApi(s: Settings): JellyfinGet {
  return async (path, init = {}) => {
    const r = await fetch(`${s.jellyfin.url!.replace(/\/+$/, '')}${s.jellyfin.basePath}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `MediaBrowser Token="${s.jellyfin.apiKey}"`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
    const text = await r.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* not JSON */
    }
    return { status: r.status, json }
  }
}

/**
 * Jellyfin's own defaults for the keys Finesse sets (a Jellyfin nobody set up for a card). Only then
 * does Finesse's first plan write them; anything else is someone's own choice.
 */
export function jellyfinDefaults(cur: Record<string, unknown>): boolean {
  const accel = cur.HardwareAccelerationType
  const codecs = Array.isArray(cur.HardwareDecodingCodecs) ? (cur.HardwareDecodingCodecs as unknown[]) : []
  return (
    (accel === undefined || accel === null || accel === '' || accel === 'none') &&
    codecs.every((c) => c === 'h264' || c === 'vc1') &&
    !cur.EnableTonemapping &&
    [undefined, null, '', '/dev/dri/renderD128'].includes(cur.VaapiDevice as string) &&
    [undefined, null, ''].includes(cur.QsvDevice as string)
  )
}

/**
 * Sets Jellyfin's encoding settings for the plan. `last` is what Finesse set before; when Jellyfin's
 * values no longer match it and the plan hasn't changed, someone chose differently in Jellyfin: left
 * alone. With no `last` (Finesse never set them), they're written only over Jellyfin's defaults;
 * otherwise left alone, and `offer` says Settings should offer Finesse's in one click (`force`).
 */
export async function applyEncoding(
  get: JellyfinGet,
  plan: Pick<GraphicsPlan, 'jellyfin'>,
  opts: { last?: Record<string, unknown>; planChanged: boolean; force?: boolean },
): Promise<{ applied: Record<string, unknown> | null; changed: string[]; note: string | null; offer?: boolean }> {
  const cur = await get('/System/Configuration/encoding')
  if (cur.status !== 200 || !cur.json || typeof cur.json !== 'object') throw new Error(`Jellyfin didn’t share its video settings (HTTP ${cur.status})`)
  const current = cur.json as Record<string, unknown>
  const want = encodingFor(plan.jellyfin)
  if (!opts.force) {
    if (!opts.last && !jellyfinDefaults(current) && mergeEncoding(current, want).changed.length) {
      return { applied: null, changed: [], offer: true, note: 'Jellyfin already has video conversion settings of its own, so Finesse left them as they are.' }
    }
    if (opts.last && !opts.planChanged && mergeEncoding(current, opts.last).changed.length) {
      return { applied: null, changed: [], offer: true, note: 'Someone changed Jellyfin’s video conversion settings in Jellyfin, so Finesse leaves them as they are.' }
    }
  }
  const { next, changed } = mergeEncoding(current, want)
  if (changed.length) {
    const r = await get('/System/Configuration/encoding', { method: 'POST', body: next })
    if (r.status >= 300) throw new Error(`Jellyfin didn’t take the video settings (HTTP ${r.status})`)
  }
  return { applied: want, changed, note: null }
}

/** Is someone using the app (so its container mustn't be recreated now)? Words when so, null when not. */
export type InUse = (id: 'jellyfin' | 'wolf', s: Settings) => Promise<string | null>

/** Jellyfin: anyone playing or converting. Wolf: any open stream. Not running: nobody. Can't tell: treated as in use. */
export function defaultInUse(orch: StackHost): InUse {
  return async (id, s) => {
    if (!(await orch.isRunning(id).catch(() => false))) return null
    if (id === 'jellyfin') {
      const r = await jellyfinApi(s)('/Sessions?ActiveWithinSeconds=600').catch(() => null)
      if (!r || r.status !== 200 || !Array.isArray(r.json)) return 'Finesse couldn’t ask Jellyfin whether anyone is watching'
      const n = (r.json as { NowPlayingItem?: unknown; TranscodingInfo?: unknown }[]).filter((x) => x.NowPlayingItem || x.TranscodingInfo).length
      return n ? `${n === 1 ? 'someone is' : `${n} people are`} watching on Jellyfin` : null
    }
    const socket = s.streaming?.socket ?? (s.stack ? wolfSocket(s.stack) : null)
    if (!socket) return 'Finesse couldn’t ask game streaming whether anyone is playing'
    try {
      const r = await wolfCall(socket, 'GET', '/api/v1/sessions', undefined, { timeoutMs: 5000 })
      const list = (JSON.parse(r.body.toString('utf8')) as { sessions?: unknown[] }).sessions
      if (r.status !== 200 || !Array.isArray(list)) return 'Finesse couldn’t ask game streaming whether anyone is playing'
      return list.length ? `${list.length === 1 ? 'someone is' : `${list.length} people are`} playing a game` : null
    } catch {
      return 'Finesse couldn’t ask game streaming whether anyone is playing'
    }
  }
}

export class GraphicsManager {
  readonly settings: SettingsStore
  readonly orch: StackHost
  private readonly event: (level: 'info' | 'warn' | 'error', message: string) => void
  private working: Promise<StoredGraphics | null> | null = null
  private queued: { reason: string; opts: { refresh?: boolean } } | null = null
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly inUse: InUse

  constructor(settings: SettingsStore, orch: StackHost, event: (level: 'info' | 'warn' | 'error', message: string) => void = () => {}, opts: { inUse?: InUse } = {}) {
    this.settings = settings
    this.orch = orch
    this.event = event
    this.inUse = opts.inUse ?? defaultInUse(orch)
  }

  /** Jellyfin's image (it has ffmpeg) for the cards' test conversions, when it's on this machine. */
  private async testImage(): Promise<string | null> {
    if (!(this.orch instanceof Orchestrator)) return null
    const img = CATALOG.jellyfin.image
    return (await this.orch.docker.imageExists(img).catch(() => false)) ? img : null
  }

  async inventory(refresh = false): Promise<Inventory | null> {
    if (!(this.orch instanceof Orchestrator)) return null
    return this.orch.graphicsInventory(await this.testImage(), refresh)
  }

  /** The plan for this server right now (nothing applied). */
  plan(inv: Inventory, s: Settings = this.settings.get()): GraphicsPlan {
    return planGraphics(inv, { streaming: Boolean(s.stack?.services.includes('wolf')), override: s.graphicsOverride })
  }

  private adopt: { at: number; result: Promise<AdoptGraphics> } | null = null

  /**
   * Someone's own Jellyfin (adopt): its container (looked at only), the cards on this server, what
   * the container can use, and the Connected-apps finding. Kept 5 minutes unless refreshed.
   */
  adoptCheck(refresh = false): Promise<AdoptGraphics> {
    if (!refresh && this.adopt && Date.now() - this.adopt.at < 5 * 60000) return this.adopt.result
    const result = this.adoptNow(refresh)
    this.adopt = { at: Date.now(), result }
    result.catch(() => (this.adopt = null))
    return result
  }

  private async adoptNow(refresh: boolean): Promise<AdoptGraphics> {
    const s = this.settings.get()
    if (!(this.orch instanceof Orchestrator)) return { inventory: null, check: null, jellyfin: null, reason: 'Finesse looks at graphics cards through Docker, which this server doesn’t use.' }
    if (!s.jellyfin.url || !s.jellyfin.apiKey) return { inventory: null, check: null, jellyfin: null, reason: 'Finesse isn’t connected to Jellyfin yet.' }
    const docker = this.orch.docker
    const jf = await findJellyfin(docker, s, (await selfContainer(docker))?.Id)
    if ('reason' in jf) {
      const inventory = await this.orch.graphicsInventory(null, refresh).catch(() => null)
      return { inventory, check: null, jellyfin: null, reason: jf.reason }
    }
    const inventory = await this.orch.graphicsInventory(jf.info.Image || jf.image, refresh)
    const visible = visibleTo(jf.info)
    const enc = await jellyfinApi(s)('/System/Configuration/encoding').catch(() => null)
    if (!enc || enc.status !== 200 || !enc.json) return { inventory, check: null, jellyfin: { name: jf.name, visible }, reason: 'Jellyfin didn’t share its video settings with Finesse’s key.' }
    return { inventory, check: jellyfinGraphicsCheck(inventory, visible, enc.json as Record<string, unknown>, jf.name), jellyfin: { name: jf.name, visible, encoding: (enc.json as { HardwareAccelerationType?: string }).HardwareAccelerationType ?? 'none' } }
  }

  /** The one-click fix: Jellyfin's settings for a working card its container can already use. Never touches the container. */
  async adoptFix(gpu: string): Promise<string> {
    const a = await this.adoptCheck(true)
    if (!a.inventory || !a.jellyfin) throw new Error(a.reason ?? 'Finesse can’t see Jellyfin’s container.')
    const card = fixCard(a.inventory, a.jellyfin.visible)
    if (!card || card.id !== gpu) throw new Error('Jellyfin’s container can’t use that card. Give it the card in the app’s own settings first, then check again.')
    const get = jellyfinApi(this.settings.get())
    const cur = await get('/System/Configuration/encoding')
    if (cur.status !== 200 || !cur.json) throw new Error(`Jellyfin didn’t share its video settings (HTTP ${cur.status}).`)
    const next = { ...(cur.json as Record<string, unknown>), ...fixSettings(card) }
    const r = await get('/System/Configuration/encoding', { method: 'POST', body: next })
    if (r.status >= 300) throw new Error(`Jellyfin didn’t take the new settings (HTTP ${r.status}).`)
    this.adopt = null
    this.event('info', `Jellyfin now converts video on ${card.name}, set by an administrator`)
    return card.name
  }

  /** Changing the containers or Jellyfin's settings right now. */
  get isWorking(): boolean {
    return this.working !== null
  }

  planKey(p: GraphicsPlan): string {
    return planKey(p)
  }

  /**
   * One change to an app's container at a time: the graphics pass and the maintainer's repairs and
   * updates take this before they create or start Jellyfin or Wolf.
   */
  async lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    const chain = prev.then(() => mine)
    this.locks.set(id, chain)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(id) === chain) this.locks.delete(id)
    }
  }

  /** The cards as they'd be planned now (a finished probe, settled with what's known), without changing anything. */
  settle(inv: Inventory, s: Settings = this.settings.get()): Inventory {
    const prev = s.stack?.graphics
    const built = builtOf(prev)
    return settleInventory(inv, { failures: prev?.failures, inventory: prev?.inventory, inUse: [built.jellyfin, built.wolf] }, inv.checkedAt !== prev?.inventory?.checkedAt).inv
  }

  /**
   * Brings the containers and Jellyfin's settings to the plan (servers Finesse set up). One pass at a
   * time; asked while one runs (an administrator's choice during the nightly pass), another pass
   * follows it with what's asked now. `retry` goes on with the stored plan (no new look at the cards).
   */
  apply(reason: string, opts: { refresh?: boolean; retry?: boolean } = {}): Promise<StoredGraphics | null> {
    if (this.working) {
      if (!opts.retry) this.queued = { reason, opts: { refresh: Boolean(opts.refresh || this.queued?.opts.refresh) } }
      return this.working
    }
    const run = async () => {
      try {
        let r = await this.applyNow(reason, opts)
        while (this.queued) {
          const q = this.queued
          this.queued = null
          r = await this.applyNow(q.reason, q.opts)
        }
        return r
      } finally {
        this.working = null
      }
    }
    this.working = run()
    return this.working
  }

  /** A postponed or failed change whose time has come (the maintenance tick asks every minute). */
  due(now = Date.now()): boolean {
    const p = this.settings.get().stack?.graphics?.pending
    return Boolean(p && Date.parse(p.next) <= now)
  }

  private save(fn: (g: StoredGraphics) => void) {
    this.settings.update((x) => {
      if (x.stack?.graphics) fn(x.stack.graphics)
    })
  }

  private async applyNow(reason: string, opts: { refresh?: boolean; retry?: boolean }): Promise<StoredGraphics | null> {
    const s = this.settings.get()
    if (s.mode !== 'bundle' || !s.stack || !(this.orch instanceof Orchestrator)) return null
    const prev = s.stack.graphics
    let plan: GraphicsPlan
    if (opts.retry && prev) plan = prev.plan
    else {
      const raw = await this.inventory(opts.refresh).catch(() => null)
      // Unknown isn't "no cards": the stored plan stands, and nothing changes.
      if (!raw || raw.complete === false) {
        log.warn(`couldn’t look at the graphics cards (${reason}): keeping the plan as it is`)
        return prev ?? null
      }
      const built = builtOf(prev)
      const settled = settleInventory(raw, { failures: prev?.failures, inventory: prev?.inventory, inUse: [built.jellyfin, built.wolf] }, raw.checkedAt !== prev?.inventory?.checkedAt)
      plan = this.plan(settled.inv, s)
      this.settings.update((x) => {
        if (x.stack) x.stack.graphics = { ...x.stack.graphics, ...(prev ? {} : { built: {} }), plan, key: planKey(plan), at: new Date().toISOString(), inventory: settled.inv, failures: settled.failures } as StoredGraphics
      })
    }
    return this.converge(plan, reason)
  }

  /** Each app's container to its card, one by one, saving each as it's done; then Jellyfin's settings. */
  private async converge(plan: GraphicsPlan, reason: string): Promise<StoredGraphics | null> {
    const orch = this.orch as Orchestrator
    const s = this.settings.get()
    const st = s.stack!
    const paused = new Set(st.paused ?? [])
    const before = builtOf(st.graphics)
    let waiting: string | null = null
    let failed: string | null = null
    let jellyfinReady = true
    for (const id of ['jellyfin', 'wolf'] as const) {
      const want = plan[id]
      const have = builtOf(this.settings.get().stack?.graphics)[id]
      // Not installed: whoever creates it later builds it with this.
      if (!st.services.includes(id)) {
        this.save((g) => void (g.built = { ...builtOf(g), [id]: want }))
        continue
      }
      // Stopped by an administrator: changed when it's started again.
      if (paused.has(id)) {
        if (assignKey(have) !== assignKey(want) && id === 'jellyfin') jellyfinReady = false
        continue
      }
      if (have && assignKey(have) === assignKey(want)) {
        this.save((g) => void (g.built = { ...builtOf(g), [id]: want }))
        continue
      }
      // A new card means a new container: never while someone is using the app.
      const busy = await this.inUse(id, this.settings.get())
      if (busy) {
        waiting = `${CATALOG[id].name} waits for its graphics card change: ${busy}`
        if (id === 'jellyfin') jellyfinReady = false
        continue
      }
      try {
        const recreated = await this.lock(id, async () => {
          const ctx = stackContext(this.settings.get(), await orch.hostDevices().catch(() => []))!
          ctx.graphics = { ...builtOf(this.settings.get().stack?.graphics), [id]: want }
          // The image it runs now: only the update flow moves an app to a new pin.
          const image = (await orch.docker.inspect(containerName(id)).catch(() => null))?.Config.Image
          return orch.ensureService(id, ctx, undefined, image ? { image } : {})
        })
        this.save((g) => void (g.built = { ...builtOf(g), [id]: want }))
        if (recreated) {
          this.event('info', `${CATALOG[id].name} now uses ${want.name ?? 'the processor'} (${reason})`)
          if (id === 'jellyfin') await orch.waitReady('jellyfin', undefined, 180000).catch(() => {})
        }
      } catch (e) {
        failed = `${CATALOG[id].name} couldn’t be given its graphics card: ${(e as Error).message}`
        this.event('error', failed)
        if (id === 'jellyfin') jellyfinReady = false
      }
    }
    // Jellyfin's own settings, through its API: only for the container it really runs.
    const jf = builtOf(this.settings.get().stack?.graphics).jellyfin
    if (jellyfinReady && jf && st.services.includes('jellyfin') && s.jellyfin.url && s.jellyfin.apiKey) {
      try {
        const g = this.settings.get().stack!.graphics!
        const r = await applyEncoding(jellyfinApi(this.settings.get()), { jellyfin: jf }, { last: g.applied, planChanged: assignKey(before.jellyfin) !== assignKey(jf) })
        if (r.changed.length) this.event('info', jf.accel === 'none' ? 'Jellyfin now converts video on the processor' : `Jellyfin now converts video on ${jf.name}`)
        this.save((x) => {
          if (r.applied) x.applied = r.applied
          x.note = r.note
          x.offer = Boolean(r.offer)
        })
      } catch (e) {
        log.warn(`Jellyfin's video settings: ${(e as Error).message}`)
        failed ??= `Finesse couldn’t set Jellyfin’s video settings yet (${(e as Error).message})`
        this.save((x) => void (x.note = `${failed}. It tries again in a while.`))
      }
    }
    const was = this.settings.get().stack?.graphics?.pending
    this.save((g) => {
      if (failed) {
        const attempts = (was?.attempts ?? 0) + 1
        g.pending = { why: failed, attempts, next: new Date(Date.now() + retryDelay(attempts)).toISOString() }
      } else if (waiting) {
        // Someone's using it: look again at the next tick (no new probe, and no backoff: asking is cheap).
        g.pending = { why: waiting, attempts: was?.attempts ?? 0, next: new Date().toISOString() }
      } else g.pending = null
    })
    return this.settings.get().stack?.graphics ?? null
  }

  /** Settings → Server → Graphics: Finesse's settings for Jellyfin, chosen by an administrator over Jellyfin's own. */
  async useOurEncoding(): Promise<void> {
    const s = this.settings.get()
    const jf = builtOf(s.stack?.graphics).jellyfin
    if (s.mode !== 'bundle' || !jf || !s.jellyfin.url || !s.jellyfin.apiKey) throw new Error('Finesse hasn’t planned Jellyfin’s card yet.')
    const r = await applyEncoding(jellyfinApi(s), { jellyfin: jf }, { planChanged: true, force: true })
    this.save((g) => {
      g.applied = r.applied ?? g.applied
      g.note = null
      g.offer = false
    })
    this.event('info', jf.accel === 'none' ? 'Jellyfin now converts video on the processor, set by an administrator' : `Jellyfin now converts video on ${jf.name}, set by an administrator`)
  }
}
