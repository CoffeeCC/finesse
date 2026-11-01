// Puts the graphics plan (graphics.ts) into effect on servers Finesse set up:
//   • Jellyfin's and Wolf's containers get their card (only Finesse's own,
//     finesse.managed=true containers, and only when the plan changes: the
//     card is part of their spec hash);
//   • Jellyfin's encoding settings are set through its API, only the keys
//     Finesse owns (graphics.ts OWNED_ENCODING), and only when they differ.
//     If someone changed them in Jellyfin since, Finesse leaves them alone
//     until the plan itself changes (a card added, gone, or chosen).
// Runs in the nightly maintenance, right away when Jellyfin or Wolf won't
// start (a card that vanished takes the app back to the processor rather
// than leaving it unable to start), and when an administrator picks a card.

import type { Settings, SettingsStore } from '../config.ts'
import { logger } from '../log.ts'
import { stackContext } from '../setup/apply.ts'
import { CATALOG } from './catalog.ts'
import { encodingFor, mergeEncoding, planGraphics, planKey, type GraphicsPlan, type Inventory } from './graphics.ts'
import type { StackHost } from './host.ts'
import { Orchestrator } from './orchestrator.ts'

const log = logger('graphics')

/** What the containers were built with, kept in settings.stack.graphics. */
export interface StoredGraphics {
  plan: GraphicsPlan
  /** planKey(plan): the containers change only when this does. */
  key: string
  at: string
  /** The cards as last found (for Settings → Server → Graphics). */
  inventory?: Inventory
  /** Jellyfin's encoding settings as Finesse last set them. */
  applied?: Record<string, unknown>
  /** Something to say about Jellyfin's settings (changed by someone in Jellyfin…). */
  note?: string | null
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
 * Sets Jellyfin's encoding settings for the plan. `last` is what Finesse set before; when Jellyfin's
 * values no longer match it and the plan hasn't changed, someone chose differently in Jellyfin: left alone.
 */
export async function applyEncoding(
  get: JellyfinGet,
  plan: Pick<GraphicsPlan, 'jellyfin'>,
  opts: { last?: Record<string, unknown>; planChanged: boolean },
): Promise<{ applied: Record<string, unknown> | null; changed: string[]; note: string | null }> {
  const cur = await get('/System/Configuration/encoding')
  if (cur.status !== 200 || !cur.json || typeof cur.json !== 'object') throw new Error(`Jellyfin didn’t share its video settings (HTTP ${cur.status})`)
  const current = cur.json as Record<string, unknown>
  if (opts.last && !opts.planChanged && mergeEncoding(current, opts.last).changed.length) {
    return { applied: null, changed: [], note: 'Someone changed Jellyfin’s video conversion settings in Jellyfin, so Finesse leaves them as they are.' }
  }
  const want = encodingFor(plan.jellyfin)
  const { next, changed } = mergeEncoding(current, want)
  if (changed.length) {
    const r = await get('/System/Configuration/encoding', { method: 'POST', body: next })
    if (r.status >= 300) throw new Error(`Jellyfin didn’t take the video settings (HTTP ${r.status})`)
  }
  return { applied: want, changed, note: null }
}

export class GraphicsManager {
  readonly settings: SettingsStore
  readonly orch: StackHost
  private readonly event: (level: 'info' | 'warn' | 'error', message: string) => void
  private working: Promise<StoredGraphics | null> | null = null

  constructor(settings: SettingsStore, orch: StackHost, event: (level: 'info' | 'warn' | 'error', message: string) => void = () => {}) {
    this.settings = settings
    this.orch = orch
    this.event = event
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

  /** Brings the containers and Jellyfin's settings to the plan (servers Finesse set up). One at a time. */
  apply(reason: string, opts: { refresh?: boolean } = {}): Promise<StoredGraphics | null> {
    this.working ??= this.applyNow(reason, opts).finally(() => (this.working = null))
    return this.working
  }

  private async applyNow(reason: string, opts: { refresh?: boolean }): Promise<StoredGraphics | null> {
    const s = this.settings.get()
    if (s.mode !== 'bundle' || !s.stack || !(this.orch instanceof Orchestrator)) return null
    const inv = await this.inventory(opts.refresh)
    if (!inv) return null
    const plan = this.plan(inv, s)
    const key = planKey(plan)
    const prev = s.stack.graphics
    const changed = prev?.key !== key
    this.settings.update((x) => {
      if (x.stack) x.stack.graphics = { ...prev, plan, key, at: new Date().toISOString(), inventory: inv }
    })
    if (changed) {
      const paused = new Set(s.stack.paused ?? [])
      const ctx = stackContext(this.settings.get(), await this.orch.hostDevices().catch(() => []))!
      for (const id of ['jellyfin', 'wolf'] as const) {
        if (!s.stack.services.includes(id) || paused.has(id)) continue
        const recreated = await this.orch.ensureService(id, ctx).catch((e) => {
          this.event('error', `${CATALOG[id].name} couldn’t be given its graphics card: ${(e as Error).message}`)
          return false
        })
        if (recreated) {
          const a = id === 'jellyfin' ? plan.jellyfin : plan.wolf
          this.event('info', `${CATALOG[id].name} now uses ${a.name ?? 'the processor'} (${reason})`)
          if (id === 'jellyfin') await this.orch.waitReady('jellyfin', undefined, 180000).catch(() => {})
        }
      }
    }
    // Jellyfin's own settings, through its API.
    if (s.jellyfin.url && s.jellyfin.apiKey) {
      try {
        const r = await applyEncoding(jellyfinApi(this.settings.get()), plan, { last: prev?.applied, planChanged: changed })
        if (r.changed.length) this.event('info', plan.jellyfin.accel === 'none' ? 'Jellyfin now converts video on the processor' : `Jellyfin now converts video on ${plan.jellyfin.name}`)
        this.settings.update((x) => {
          if (x.stack?.graphics) x.stack.graphics = { ...x.stack.graphics, ...(r.applied ? { applied: r.applied } : {}), note: r.note }
        })
      } catch (e) {
        log.warn(`Jellyfin's video settings: ${(e as Error).message}`)
        this.settings.update((x) => {
          if (x.stack?.graphics) x.stack.graphics.note = `Finesse couldn’t set Jellyfin’s video settings yet (${(e as Error).message}). It tries again tonight.`
        })
      }
    }
    return this.settings.get().stack?.graphics ?? null
  }
}
