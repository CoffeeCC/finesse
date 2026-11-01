// Graphics: which card each part of Finesse uses. Pure, so every hardware case
// is unit-tested (server/test/graphics.test.ts); gpus.ts finds the cards.
//
// The plan, with no setup from anyone:
//   • no usable card: Jellyfin converts on the CPU, carefully (direct play
//     first, one conversion at a time), clips are made only at night, and game
//     streaming stays off (it needs a card);
//   • one card: shared. Game streaming (Wolf) comes first, so Jellyfin's
//     conversions are capped while it's on;
//   • a built-in chip and a graphics card: Jellyfin on the chip (Quick Sync or
//     VA-API), Wolf on the card;
//   • two or more cards: Wolf on the strongest, Jellyfin on another.
// Cards are always named exactly (an NVIDIA UUID, or one /dev/dri render
// node), never "all". A card that fails its test encode isn't used.
// An administrator's choice (Settings → Server → Graphics) wins while that
// card is still there and working.

export type Vendor = 'nvidia' | 'intel' | 'amd' | 'other'
export type Accel = 'nvenc' | 'qsv' | 'vaapi' | 'none'

export interface Gpu {
  /** "nvidia:GPU-…" or "dri:renderD128". */
  id: string
  vendor: Vendor
  /** As people know it: "NVIDIA GeForce RTX 3060", "Intel graphics". */
  name: string
  /** Built into the processor. */
  integrated: boolean
  /** PCI address, e.g. 0000:01:00.0. */
  pci?: string
  /** Its /dev/dri render node, e.g. /dev/dri/renderD128. */
  renderNode?: string
  /** NVIDIA's id for it (what containers are given). */
  uuid?: string
  vramMiB?: number
  /** A test encode on this card: worked (true), failed (false), not tried (null). */
  encodes: boolean | null
  /** What the test said when it failed, short. */
  problem?: string
  /** Hardware video conversions it allows at once (GeForce: 8); null when there's no limit. */
  sessionLimit: number | null
  /** Codecs it can decode, as Jellyfin names them. */
  decode: string[]
}

export interface Inventory {
  checkedAt: string
  gpus: Gpu[]
  /** Docker can hand NVIDIA cards to containers (the NVIDIA container toolkit). */
  nvidiaRuntime: boolean
}

/** What an administrator picked: a card id, "cpu" (Jellyfin only), or nothing (automatic). */
export interface GraphicsOverride {
  jellyfin?: string
  wolf?: string
}

export interface Assignment {
  /** The card's id, or null for the CPU. */
  gpu: string | null
  name: string | null
  vendor: Vendor | null
  accel: Accel
  uuid?: string
  renderNode?: string
}

export interface JellyfinPlan extends Assignment {
  decode: string[]
  /** Conversions at once; null when only the card's own limit applies. */
  maxTranscodes: number | null
  /** The card is shared with game streaming. */
  shared: boolean
  why: string
}

export interface WolfPlan extends Assignment {
  why: string
}

export interface GraphicsPlan {
  jellyfin: JellyfinPlan
  /** Wolf's card; gpu null means streaming can't run here (why says so). */
  wolf: WolfPlan
  /** No card: clips only in the quiet hours. */
  clipsNightOnly: boolean
  /** Things worth telling the administrator (a card that failed its test…). */
  notes: string[]
}

/** NVIDIA cards made for workstations and data centres have no conversion limit; GeForce allows 8 at once. */
export const NVENC_CONSUMER_LIMIT = 8
export function nvidiaSessionLimit(name: string): number | null {
  return /quadro|tesla|\brtx a\d|\b(a|l)\d{1,3}\b|\bt4\b|\bh100\b|rtx \d{4} ada/i.test(name) ? null : NVENC_CONSUMER_LIMIT
}

/** Codecs an NVIDIA card decodes, by generation from its name (conservative when unsure). */
export function nvidiaDecode(name: string): string[] {
  const base = ['h264', 'hevc', 'mpeg2video', 'vc1', 'vp8', 'vp9']
  // Ampere (RTX 30, A-series) and newer decode AV1.
  if (/rtx\s*(3|4|5)0\d0|rtx a\d|\b(a|l)\d{1,3}\b|ada|blackwell/i.test(name)) return [...base, 'av1']
  // Pascal and Turing (GTX 10/16, RTX 20): HEVC 10-bit and VP9.
  if (/gtx\s*1[06]\d0|rtx\s*20\d0|titan (x|v|rtx)|quadro (p|t|rtx)/i.test(name)) return base
  // Older or unknown: what every NVDEC card does.
  return ['h264', 'mpeg2video', 'vc1']
}

/** Codecs Intel and AMD chips decode through VA-API / Quick Sync (conservative). */
export function driDecode(vendor: Vendor, modern: boolean): string[] {
  if (vendor === 'intel') return ['h264', 'hevc', 'mpeg2video', 'vc1', 'vp8', 'vp9', ...(modern ? ['av1'] : [])]
  if (vendor === 'amd') return ['h264', 'hevc', 'mpeg2video', 'vc1', 'vp9', ...(modern ? ['av1'] : [])]
  return []
}

const VENDOR_RANK: Record<Vendor, number> = { nvidia: 3, amd: 2, intel: 1, other: 0 }

/** Stronger first: a separate card over a built-in chip, then vendor, memory, a passed test, then PCI order. */
export function strongestFirst(gpus: Gpu[]): Gpu[] {
  return [...gpus].sort(
    (a, b) =>
      Number(a.integrated) - Number(b.integrated) ||
      VENDOR_RANK[b.vendor] - VENDOR_RANK[a.vendor] ||
      (b.vramMiB ?? 0) - (a.vramMiB ?? 0) ||
      Number(b.encodes === true) - Number(a.encodes === true) ||
      (a.pci ?? a.id).localeCompare(b.pci ?? b.id),
  )
}

/** Why a card can't be used, or null when it can. */
export function unusable(g: Gpu, inv: Pick<Inventory, 'nvidiaRuntime'>): string | null {
  if (g.vendor === 'other') return `${g.name} isn’t a card Jellyfin can convert video on.`
  if (g.vendor === 'nvidia' && !inv.nvidiaRuntime) return `${g.name} needs the NVIDIA Container Toolkit before apps in Docker can use it.`
  if (g.vendor === 'nvidia' && !g.uuid) return `${g.name} couldn’t be identified (no NVIDIA id), so Finesse can’t give it to an app.`
  if (g.encodes === false) return `${g.name}${g.pci ? ` (${g.pci.replace(/^0000:/, '')})` : ''} failed a test video conversion${g.problem ? ` (${g.problem})` : ''}, so Finesse doesn’t use it.`
  return null
}

const accelOf = (g: Gpu): Accel => (g.vendor === 'nvidia' ? 'nvenc' : g.vendor === 'intel' ? 'qsv' : g.vendor === 'amd' ? 'vaapi' : 'none')

function assign(g: Gpu | null): Assignment {
  if (!g) return { gpu: null, name: null, vendor: null, accel: 'none' }
  return { gpu: g.id, name: g.name, vendor: g.vendor, accel: accelOf(g), ...(g.uuid ? { uuid: g.uuid } : {}), ...(g.renderNode ? { renderNode: g.renderNode } : {}) }
}

/** Plans which card Jellyfin and Wolf use. */
export function planGraphics(inv: Inventory, opts: { streaming: boolean; override?: GraphicsOverride }): GraphicsPlan {
  const notes: string[] = []
  const usable: Gpu[] = []
  for (const g of inv.gpus) {
    const why = unusable(g, inv)
    if (why) notes.push(why)
    else usable.push(g)
  }
  const ranked = strongestFirst(usable)
  let jf: Gpu | null = null
  let wolf: Gpu | null = null
  let jfWhy = ''
  let wolfWhy = ''
  if (!ranked.length) {
    jfWhy = inv.gpus.length ? 'No card here can convert video for Jellyfin, so it uses the processor.' : 'This server has no graphics card, so Jellyfin converts video on the processor.'
    wolfWhy = inv.gpus.length ? 'Game streaming needs a working graphics card, and none here passed the test.' : 'Game streaming needs a graphics card, and this server has none.'
  } else if (ranked.length === 1) {
    jf = wolf = ranked[0]!
    jfWhy = `${jf.name} is the only card, so Jellyfin uses it${opts.streaming ? ', sharing it with game streaming (games come first)' : ''}.`
    wolfWhy = `${wolf.name} is the only card.`
  } else {
    const chips = ranked.filter((g) => g.integrated)
    const cards = ranked.filter((g) => !g.integrated)
    if (chips.length && cards.length) {
      jf = chips[0]!
      wolf = cards[0]!
      jfWhy = `Jellyfin uses the built-in ${jf.name}, which handles video conversion well, and leaves ${wolf.name} for games.`
      wolfWhy = `${wolf.name} is the strongest card here.`
    } else {
      wolf = ranked[0]!
      jf = ranked[1]!
      jfWhy = `Jellyfin uses ${jf.name}${jf.pci ? ` (${jf.pci.replace(/^0000:/, '')})` : ''}, so games keep the strongest card to themselves.`
      wolfWhy = `${wolf.name}${wolf.pci ? ` (${wolf.pci.replace(/^0000:/, '')})` : ''} is the strongest card here.`
    }
  }

  // An administrator's choice wins while that card is still here and working.
  const pick = (who: 'Jellyfin' | 'game streaming', want: string | undefined): Gpu | null | undefined => {
    if (!want) return undefined
    if (want === 'cpu' && who === 'Jellyfin') return null
    const g = usable.find((x) => x.id === want)
    if (g) return g
    const gone = inv.gpus.find((x) => x.id === want)
    notes.push(`The card chosen for ${who}${gone ? ` (${gone.name})` : ''} ${gone ? 'can’t be used right now' : 'isn’t here any more'}, so Finesse chose automatically.`)
    return undefined
  }
  const jfPick = pick('Jellyfin', opts.override?.jellyfin)
  if (jfPick !== undefined) {
    jf = jfPick
    jfWhy = jf ? `Jellyfin uses ${jf.name}, as an administrator chose.` : 'Jellyfin converts video on the processor, as an administrator chose.'
  }
  const wolfPick = pick('game streaming', opts.override?.wolf)
  if (wolfPick) {
    wolf = wolfPick
    wolfWhy = `Game streaming uses ${wolf.name}, as an administrator chose.`
  }

  const shared = Boolean(opts.streaming && jf && wolf && jf.id === wolf.id)
  let maxTranscodes: number | null
  if (!jf) maxTranscodes = 1
  else if (shared) maxTranscodes = Math.min(2, jf.sessionLimit ?? 2)
  else maxTranscodes = jf.sessionLimit
  if (shared) jfWhy += ` While game streaming is on, Jellyfin converts at most ${maxTranscodes} videos at once.`
  return {
    jellyfin: { ...assign(jf), decode: jf ? jf.decode : [], maxTranscodes, shared, why: jfWhy },
    wolf: { ...assign(wolf), why: wolfWhy },
    clipsNightOnly: !ranked.length,
    notes,
  }
}

/** What decides the containers: two plans with the same key need no change. */
export function planKey(p: Pick<GraphicsPlan, 'jellyfin' | 'wolf'>): string {
  const a = (x: Assignment) => [x.gpu ?? 'cpu', x.accel, x.uuid ?? '', x.renderNode ?? ''].join(',')
  return `${a(p.jellyfin)}|${a(p.wolf)}`
}

// ---------- Jellyfin's encoding settings ----------

/** The settings Finesse sets in Jellyfin (Dashboard → Playback → Transcoding). Nothing else is touched. */
export const OWNED_ENCODING = [
  'HardwareAccelerationType',
  'EnableHardwareEncoding',
  'HardwareDecodingCodecs',
  'EnableDecodingColorDepth10Hevc',
  'EnableDecodingColorDepth10Vp9',
  'EnableTonemapping',
  'VaapiDevice',
  'QsvDevice',
  'EnableThrottling',
] as const

/** Jellyfin's encoding settings for an assignment. */
export function encodingFor(a: Pick<JellyfinPlan, 'accel' | 'decode' | 'renderNode'>): Record<string, unknown> {
  if (a.accel === 'none') {
    // The processor: no hardware, and Jellyfin stops converting ahead of the viewer when it's far enough along.
    return { HardwareAccelerationType: 'none', EnableHardwareEncoding: false, HardwareDecodingCodecs: [], EnableThrottling: true }
  }
  const out: Record<string, unknown> = {
    HardwareAccelerationType: a.accel,
    EnableHardwareEncoding: true,
    HardwareDecodingCodecs: a.decode,
    EnableDecodingColorDepth10Hevc: a.decode.includes('hevc'),
    EnableDecodingColorDepth10Vp9: a.decode.includes('vp9'),
    EnableTonemapping: true,
  }
  if (a.accel === 'vaapi' && a.renderNode) out.VaapiDevice = a.renderNode
  if (a.accel === 'qsv' && a.renderNode) out.QsvDevice = a.renderNode
  return out
}

/** `current` with `want` laid over it; which of those keys changed. Every other setting stays as it was. */
export function mergeEncoding(current: Record<string, unknown>, want: Record<string, unknown>): { next: Record<string, unknown>; changed: string[] } {
  const changed = Object.keys(want).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(want[k]))
  return { next: { ...current, ...want }, changed }
}

/** Jellyfin converts on the CPU (no hardware type set). */
export const onCpu = (e: Record<string, unknown>) => !e.HardwareAccelerationType || e.HardwareAccelerationType === 'none'
