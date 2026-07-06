// Preview-clip plumbing shared by the card hover-preview and the detail hero:
//   • pick the right clip resolution for the user's quality pref
//   • enforce that only ONE preview ever plays at a time
//   • warm (prefetch) clips that scroll into view so hover is instant
//
// Clips are pre-generated on the NAS (deploy/genclips.sh): the base file is
// `<id>.mp4` (480p, always present); higher tiers are `<id>.720.mp4` /
// `<id>.1080.mp4` and are advertised in previews/manifest-hd.json.

import { CONTENT_BASE } from './contentOrigin'
import { PREVIEW_QUALITY_HEIGHT, type PreviewQuality } from './settings'

export interface ClipManifest {
  /** IDs that have at least the base 480p clip (`<id>.mp4`). */
  has: Set<string>
  /** ID → available HD heights above 480 (e.g. [720, 1080]). */
  hd: Map<string, number[]>
}

export const EMPTY_MANIFEST: ClipManifest = { has: new Set(), hd: new Map() }

/** Best clip URL for an item at the user's quality, or null if it has no clip.
 *  Falls back down the ladder when a tier hasn't been generated yet. */
export function previewClipUrl(
  id: string,
  quality: PreviewQuality,
  m: ClipManifest,
): string | null {
  if (!m.has.has(id)) return null
  const target = PREVIEW_QUALITY_HEIGHT[quality]
  const available = [480, ...(m.hd.get(id) ?? [])]
  // Largest available height not exceeding the target (never below 480).
  let pick = 480
  for (const h of available) if (h <= target && h > pick) pick = h
  const file = pick === 480 ? `${id}.mp4` : `${id}.${pick}.mp4`
  return `${CONTENT_BASE}previews/${file}`
}

// ---------- Single-preview-at-a-time lock ----------
// A card or the hero "claims" playback when its clip starts; claiming stops
// whatever was playing before, so hovering across a shelf never stacks audio
// or burns decoders on several videos at once.

let activeStop: (() => void) | null = null

export function claimPreview(stop: () => void): void {
  if (activeStop && activeStop !== stop) activeStop()
  activeStop = stop
}

export function releasePreview(stop: () => void): void {
  if (activeStop === stop) activeStop = null
}

// ---------- Prefetch (warm clips that scroll into view) ----------

const warmed = new Set<string>()
const queue: string[] = []
let inFlight = 0
const MAX_CONCURRENT = 2

function pump(): void {
  while (inFlight < MAX_CONCURRENT && queue.length) {
    const url = queue.shift()!
    inFlight++
    // A plain GET populates the HTTP cache; the <video> then starts instantly.
    fetch(url, { credentials: 'omit' })
      .catch(() => {})
      .finally(() => {
        inFlight--
        pump()
      })
  }
}

/** Queue a clip to warm the browser cache (deduped, concurrency-capped). */
export function prefetchClip(url: string | null): void {
  if (!url || warmed.has(url)) return
  warmed.add(url)
  queue.push(url)
  pump()
}

// One shared observer for prefetch-on-visible, so a grid of cards costs one IO.
let io: IntersectionObserver | null = null
const onVisible = new WeakMap<Element, () => void>()

function observer(): IntersectionObserver {
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          onVisible.get(e.target)?.()
          io!.unobserve(e.target)
          onVisible.delete(e.target)
        }
      },
      { rootMargin: '150px' },
    )
  }
  return io
}

/** Warm `url` once `el` scrolls (near) into view. Returns a cleanup fn. */
export function prefetchWhenVisible(el: Element, url: string | null): () => void {
  if (!url || typeof IntersectionObserver === 'undefined') {
    prefetchClip(url)
    return () => {}
  }
  onVisible.set(el, () => prefetchClip(url))
  observer().observe(el)
  return () => {
    onVisible.delete(el)
    io?.unobserve(el)
  }
}
