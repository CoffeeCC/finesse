// Connected apps → Jellyfin's video conversion, on servers using someone's own
// Jellyfin (adopt). Finesse never changes that container; it only looks at
// which cards it was given (its device requests, NVIDIA_VISIBLE_DEVICES, its
// /dev/dri devices) and at Jellyfin's own settings, and says plainly when
// Jellyfin converts on the processor while a card is right there. When the
// container can already use a working card, an administrator can switch
// Jellyfin's settings to it in one click; otherwise the finding says what to
// do in the app's own settings.

import type { ConnCheck } from './connections.ts'
import type { ContainerInspect } from './stack/docker.ts'
import { encodingFor, onCpu, strongestFirst, unusable, type Gpu, type Inventory, type JellyfinPlan } from './stack/graphics.ts'

/** The cards a container was given: every NVIDIA card, some by UUID or index, and /dev/dri nodes. */
export interface Visible {
  nvidiaAll: boolean
  uuids: string[]
  /** NVIDIA cards given by index (NVIDIA_VISIBLE_DEVICES=0,1). */
  indexes: number[]
  driAll: boolean
  nodes: string[]
}

/** Which cards a container can use, from its inspect data (pure). */
export function visibleTo(info: Pick<ContainerInspect, 'HostConfig' | 'Config' | 'Mounts'>): Visible {
  const v: Visible = { nvidiaAll: false, uuids: [], indexes: [], driAll: false, nodes: [] }
  const hc = info.HostConfig as { DeviceRequests?: { Driver?: string; Count?: number; DeviceIDs?: string[] | null; Capabilities?: string[][] }[] | null; Devices?: { PathOnHost?: string }[] | null; Runtime?: string; Binds?: string[] | null }
  const addIds = (ids: string[]) => {
    for (const raw of ids.map((x) => x.trim()).filter(Boolean)) {
      if (raw === 'all') v.nvidiaAll = true
      else if (/^\d+$/.test(raw)) v.indexes.push(Number(raw))
      else if (raw !== 'none' && raw !== 'void') v.uuids.push(raw)
    }
  }
  for (const r of hc.DeviceRequests ?? []) {
    const nvidia = r.Driver === 'nvidia' || (r.Capabilities ?? []).some((c) => c.includes('gpu'))
    if (!nvidia) continue
    if (r.DeviceIDs?.length) addIds(r.DeviceIDs)
    else if (r.Count === -1 || (r.Count ?? 0) > 0) v.nvidiaAll = true
  }
  const env = Object.fromEntries((info.Config.Env ?? []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]))
  // The NVIDIA runtime reads this variable; without the runtime or a request it does nothing.
  if (env.NVIDIA_VISIBLE_DEVICES && (hc.Runtime === 'nvidia' || hc.DeviceRequests?.length)) {
    const ids = env.NVIDIA_VISIBLE_DEVICES.split(',')
    // A request by UUID already narrowed it; the variable says the same.
    if (!v.uuids.length && !v.indexes.length) {
      v.nvidiaAll = false
      addIds(ids)
    }
  }
  for (const d of hc.Devices ?? []) {
    const p = d.PathOnHost ?? ''
    if (p === '/dev/dri' || p === '/dev/dri/') v.driAll = true
    else if (p.startsWith('/dev/dri/')) v.nodes.push(p)
  }
  for (const m of info.Mounts ?? []) if (m.Source === '/dev/dri' || m.Source === '/dev') v.driAll = true
  for (const b of hc.Binds ?? []) if (/^\/dev(\/dri)?:/.test(b)) v.driAll = true
  return v
}

/** Whether the container can use this card (pure). NVIDIA cards by index use their place among the host's NVIDIA cards. */
export function canSee(v: Visible, g: Gpu, inv: Inventory): boolean {
  if (g.vendor === 'nvidia') {
    if (v.nvidiaAll) return true
    if (g.uuid && v.uuids.includes(g.uuid)) return true
    const idx = inv.gpus.filter((x) => x.vendor === 'nvidia').findIndex((x) => x.id === g.id)
    return idx >= 0 && v.indexes.includes(idx)
  }
  return v.driAll || Boolean(g.renderNode && v.nodes.includes(g.renderNode))
}

const short = (g: Gpu) => `${g.name}${g.pci ? ` (${g.pci.replace(/^0000:/, '')})` : ''}`

/** The card Jellyfin's settings should use: the strongest working card its container can already see. */
export function fixCard(inv: Inventory, v: Visible): Gpu | null {
  return strongestFirst(inv.gpus.filter((g) => !unusable(g, inv) && g.encodes !== null && canSee(v, g, inv)))[0] ?? null
}

/** Jellyfin's settings for that card. */
export function fixSettings(g: Gpu): Record<string, unknown> {
  const accel = g.vendor === 'nvidia' ? 'nvenc' : g.vendor === 'intel' ? 'qsv' : 'vaapi'
  return encodingFor({ accel, decode: g.decode, renderNode: g.renderNode } as Pick<JellyfinPlan, 'accel' | 'decode' | 'renderNode'>)
}

export type GraphicsCheck = ConnCheck & { fix?: { label: string; gpu: string } }

/** The finding for Jellyfin's video conversion (pure). Null when there's nothing to say (no card at all). */
export function jellyfinGraphicsCheck(inv: Inventory, v: Visible, encoding: Record<string, unknown>, where: string): GraphicsCheck | null {
  if (!inv.gpus.length) return null
  const base = { id: 'jellyfin-graphics', name: 'Jellyfin video conversion', problems: [] as string[] }
  const working = inv.gpus.filter((g) => !unusable(g, inv))
  const seen = inv.gpus.filter((g) => canSee(v, g, inv))
  if (onCpu(encoding)) {
    const best = strongestFirst(working)[0]
    if (!best) return { ...base, ok: true, summary: 'Converts video on the processor (no card here passed a test conversion).' }
    const card = fixCard(inv, v)
    if (card) {
      return {
        ...base,
        ok: null,
        summary: `Jellyfin converts video on the CPU, but this server has an ${card.name}.`,
        problems: [`Jellyfin’s container (${where}) can already use ${short(card)}. Switch Jellyfin to it: playing something that needs converting gets much lighter on the server.`],
        fix: { label: `Use the ${card.name.replace(/^NVIDIA (GeForce )?/, '')}`, gpu: card.id },
      }
    }
    return {
      ...base,
      ok: null,
      summary: `Jellyfin converts video on the CPU, but this server has an ${best.name}.`,
      problems: [
        `Jellyfin’s container (${where}) can’t use the card yet. Give it the card in the app’s own settings (on TrueNAS: Apps → Jellyfin → Edit → GPU Configuration${best.uuid ? `, ${best.uuid}` : ''}), then check again.`,
      ],
    }
  }
  // Set to a card type: is the card it can see working?
  const accel = String(encoding.HardwareAccelerationType)
  const kind = accel === 'nvenc' ? 'nvidia' : null
  const candidates = seen.filter((g) => (kind ? g.vendor === kind : g.vendor !== 'nvidia'))
  if (candidates.length && candidates.every((g) => g.encodes === false)) {
    const ok = strongestFirst(working.filter((g) => g.vendor === candidates[0]!.vendor))[0]
    return {
      ...base,
      ok: false,
      summary: `Jellyfin is set to convert video on ${candidates.map(short).join(', ')}, but it failed a test conversion.`,
      problems: [
        `${candidates[0]!.problem ? `The test said: ${candidates[0]!.problem}. ` : ''}Videos that need converting may not play. ${ok ? `Give Jellyfin’s container ${short(ok)} instead (it passed${ok.uuid ? `; ${ok.uuid}` : ''}), in the app’s own settings.` : 'Restart the server, or set Jellyfin to convert on the processor.'}`,
      ],
    }
  }
  const using = candidates.find((g) => g.encodes === true) ?? candidates[0]
  return { ...base, ok: true, summary: using ? `Converts video on ${short(using)}.` : `Converts video with ${accel}.` }
}
