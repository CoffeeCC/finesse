// Preview clips for hover previews and the detail hero: a short 480p clip per
// movie (plus 720p/1080p tiers when the source has them) and, for episodes, a
// spoiler-light "next time on…" teaser of four 5-second cuts from the first
// half. Jellyfin's own ffmpeg does it, at the lowest CPU priority, one item at
// a time, so it never gets in the way of anyone watching. Incremental:
// finished clips are skipped, so a big library fills in over a few quiet hours.
// Manifests match deploy/genclips.sh.
//
// Where ffmpeg runs:
//   • servers Finesse set up: inside its own Jellyfin container (or next to
//     Jellyfin on Windows), as before;
//   • someone's own Jellyfin in Docker ("adopt"): in a short-lived container
//     Finesse makes from Jellyfin's image, with only the folder holding the
//     title mounted read-only, at the lowest CPU priority, no network. The clip
//     is copied out into Finesse's own previews folder, and the container is
//     removed. Jellyfin's container is only looked at, never changed.
//   • anything else: no clips, and the status says why.
//
// Clips are named by Jellyfin item id. When Jellyfin's ids change (an upgrade
// or a rebuilt library), the old clips match nothing: after a complete listing
// of the library, clips of ids Jellyfin no longer has are removed, carefully:
// never when the library shrank by more than a tenth since the last listing
// (a Jellyfin mid-rebuild), and only an id missing from two listings in a row.
//
// manifest.json (what the app shows previews for) is rebuilt from the folder
// each time, written to a temporary file and renamed into place, and never
// written empty while clip files are there: it always matches the files.

import { accessSync, chownSync, constants, copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Paths, Settings, SettingsStore } from '../config.ts'
import { logger } from '../log.ts'
import type { Docker } from './docker.ts'
import type { StackHost } from './host.ts'
import { findJellyfin, type JellyfinContainer } from './jellyfinContainer.ts'

const log = logger('clips')

interface Item {
  Id: string
  Type: 'Movie' | 'Episode'
  Path?: string
  RunTimeTicks?: number
  MediaStreams?: { Type: string; Height?: number }[]
}

/** Runs ffmpeg for one clip. `file` is where the finished clip is on this machine (moved into the previews folder). */
export interface ClipEncoder {
  /** In words, for the status line. */
  where: string
  encode(args: string[], out: string, src: string): Promise<{ file: string | null; output: string }>
}

export interface ClipStatus {
  enabled: boolean
  /** making: working through the list · idle: nothing to do (or waiting for quiet) · blocked: can't (see reason) · off */
  state: 'making' | 'idle' | 'blocked' | 'off'
  /** Why clips can't be made (or are waiting), in plain words. */
  reason: string | null
  /** Where ffmpeg runs, in words. */
  where: string | null
  /** Titles with a clip, of `total` titles with a video file. */
  made: number
  pending: number
  total: number
  /** Titles whose clip failed twice (skipped until Finesse restarts). */
  failed: number
  /** Clips of titles Jellyfin no longer has, removed on the last run. */
  removed: number
  lastRun: string | null
}

/** Jellyfin's ffmpeg in its official and LinuxServer images. */
export const JELLYFIN_FFMPEG = '/usr/lib/jellyfin-ffmpeg/ffmpeg'
const CLIP_RE = /^([0-9a-f]{32})(?:\.(720|1080))?\.mp4$/

/** Clip files whose title isn't among `ids` (pure). Nothing when the list is empty: an empty library is more likely a Jellyfin mid-rebuild. */
export function orphanClips(names: string[], ids: Set<string>): string[] {
  if (!ids.size) return []
  return names.filter((n) => {
    const m = CLIP_RE.exec(n)
    return m ? !ids.has(m[1]!) : false
  })
}

/** What pruning remembers between runs (.prune.json in the previews folder). */
export interface PruneState {
  /** Titles in the last complete listing. */
  count?: number
  /** Ids with clips that the last listing didn't have. */
  candidates?: string[]
}

/**
 * Which clip files to remove now, and what to remember (pure). Nothing when the listing is empty or
 * has over 10% fewer titles than the last one; a clip goes only when its id was missing from the
 * last listing too.
 */
export function pruneOrphans(names: string[], ids: Set<string>, prev: PruneState): { remove: string[]; next: PruneState; skipped: boolean } {
  if (!ids.size) return { remove: [], next: prev, skipped: true }
  if (prev.count && ids.size < prev.count * 0.9) return { remove: [], next: { ...prev, count: ids.size }, skipped: true }
  const orphans = orphanClips(names, ids)
  const missing = [...new Set(orphans.map((n) => CLIP_RE.exec(n)![1]!))]
  const before = new Set(prev.candidates ?? [])
  const remove = orphans.filter((n) => before.has(CLIP_RE.exec(n)![1]!))
  return { remove, next: { count: ids.size, candidates: missing.filter((id) => !before.has(id)) }, skipped: false }
}

/** manifest.json (ids with a base clip) and manifest-hd.json ({id: [720, 1080]}) for these file names (pure). */
export function manifestsFor(names: string[]): { base: string[]; hd: Record<string, number[]> } {
  const mp4 = names.filter((n) => n.endsWith('.mp4') && !n.startsWith('.'))
  const base = mp4.filter((n) => !/\.(720|1080)\.mp4$/.test(n)).map((n) => n.slice(0, -4)).sort()
  const hd: Record<string, number[]> = {}
  for (const n of mp4) {
    const m = /^(.+)\.(720|1080)\.mp4$/.exec(n)
    if (m) (hd[m[1]!] ??= []).push(Number(m[2]))
  }
  return { base, hd }
}

/**
 * Writes the manifests from the folder as it is now: each to a temporary file, then renamed into
 * place. Refuses to write an empty manifest while clip files are there (the old one stays):
 * returns false then.
 */
export function writeManifestFiles(dir: string): boolean {
  const names = readdirSync(dir)
  const { base, hd } = manifestsFor(names)
  if (!base.length && names.some((n) => n.endsWith('.mp4') && !n.startsWith('.'))) {
    log.warn('not writing an empty manifest.json while clip files are there')
    return false
  }
  const write = (file: string, data: unknown) => {
    const tmp = join(dir, `.${file}.tmp`)
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, join(dir, file))
  }
  write('manifest-hd.json', hd)
  write('manifest.json', base)
  return true
}

/** Clips wait for the night on servers with no usable graphics card (graphics.ts clipsNightOnly): why, or null when it's time. */
export function clipsWait(s: Settings, now = new Date()): string | null {
  const g = s.mode === 'bundle' ? s.stack?.graphics : undefined
  if (!g?.plan.clipsNightOnly) return null
  const h = now.getHours()
  return h >= 1 && h < 7 ? null : 'There’s no graphics card here, so clips are made at night (1 to 7 am), when the processor is free.'
}

/** The mount of `src`'s folder: the deepest mount whose destination holds it. */
export function mountFor<M extends { Destination: string }>(mounts: M[], src: string): M | null {
  let best: M | null = null
  const len = (m: M) => m.Destination.replace(/\/+$/, '').length
  for (const m of mounts) {
    const d = m.Destination.replace(/\/+$/, '')
    if ((src === d || src.startsWith(`${d}/`)) && (!best || d.length > len(best))) best = m
  }
  return best
}

const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`

/** ffmpeg in a throwaway container made from Jellyfin's image (someone's own Jellyfin in Docker). */
export function adoptEncoder(docker: Docker, jf: JellyfinContainer, ffmpeg: string, previews: string): ClipEncoder {
  const user = jf.info.Config.User || undefined
  const groups = (jf.info.HostConfig.GroupAdd as string[] | null | undefined) ?? []
  return {
    where: `in a short-lived helper made from Jellyfin’s image (${jf.name}), reading your library read-only`,
    async encode(args, out, src) {
      const m = mountFor(jf.info.Mounts, src)
      if (!m) return { file: null, output: `${src} isn’t in a folder Jellyfin’s container mounts` }
      const from = m.Type === 'volume' && m.Name ? m.Name : m.Source
      const inside = `/tmp/${out}`
      const cmd = `T=; command -v timeout >/dev/null 2>&1 && T='timeout 1200'; $T nice -n 19 ${q(ffmpeg)} ${args.map(q).join(' ')} ${q(inside)}`
      const r = await docker.runJob(jf.info.Image || jf.image, ['sh', '-c', cmd], {
        // The Mounts form: a folder with a ":" in its path works too.
        mounts: [{ Type: m.Type === 'volume' && m.Name ? 'volume' : 'bind', Source: from, Target: m.Destination, ReadOnly: true }],
        user,
        // The lowest CPU share Docker allows: anyone watching always comes first.
        host: { CpuShares: 2, ...(groups.length ? { GroupAdd: groups } : {}) },
        file: inside,
        timeoutMs: 25 * 60000,
        service: 'clip',
      })
      if (!r.data?.length) return { file: null, output: r.output }
      const part = join(previews, `.${out}.part`)
      writeFileSync(part, r.data)
      return { file: part, output: r.output }
    },
  }
}

export interface ClipOptions {
  /** Docker, for someone's own Jellyfin in a container. */
  docker?: Docker | null
  /** Finesse's own container id (never mistaken for Jellyfin's). */
  self?: () => Promise<string | undefined>
  /** Overrides how the encoder is found (tests). */
  encoder?: (s: Settings) => Promise<ClipEncoder | { reason: string }>
  /** Clips only at some times (no graphics card: the quiet hours). Says why when it's not time. */
  waitFor?: () => string | null
}

export class ClipMaker {
  private running = false
  private timer: NodeJS.Timeout | null = null
  private failed = new Map<string, number>()
  readonly settings: SettingsStore
  readonly host: StackHost
  readonly paths: Paths
  private readonly idle: () => boolean
  private readonly opts: ClipOptions
  private found: { at: number; enc: ClipEncoder | { reason: string } } | null = null
  status: ClipStatus = { enabled: true, state: 'idle', reason: null, where: null, made: 0, pending: 0, total: 0, failed: 0, removed: 0, lastRun: null }

  constructor(settings: SettingsStore, host: StackHost, paths: Paths, idle: () => boolean, opts: ClipOptions = {}) {
    this.settings = settings
    this.host = host
    this.paths = paths
    this.idle = idle
    this.opts = opts
  }

  start(everyMs = 5 * 60000) {
    if (this.timer) return
    const go = () => void this.run().catch((e) => log.warn('clip run failed', e))
    setTimeout(go, 90000).unref()
    this.timer = setInterval(go, everyMs)
    this.timer.unref()
  }

  /** Every movie and episode Jellyfin has. Throws unless the listing is complete. */
  private async items(s: Settings): Promise<Item[]> {
    const base = `${s.jellyfin.url!.replace(/\/+$/, '')}${s.jellyfin.basePath}`
    const r = await fetch(`${base}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Fields=Path,MediaStreams&EnableImages=false&EnableUserData=false&EnableTotalRecordCount=true`, {
      headers: { Authorization: `MediaBrowser Token="${s.jellyfin.apiKey}"` },
      signal: AbortSignal.timeout(120000),
    })
    if (!r.ok) throw new Error(`Jellyfin answered ${r.status}`)
    const body = (await r.json()) as { Items?: Item[]; TotalRecordCount?: number }
    if (!Array.isArray(body.Items)) throw new Error('its answer had no list of titles')
    if (typeof body.TotalRecordCount === 'number' && body.TotalRecordCount > body.Items.length) throw new Error(`it listed ${body.Items.length} of ${body.TotalRecordCount} titles`)
    return body.Items
  }

  /** How clips get made here, or why they can't (looked up at most every 10 minutes). */
  private async encoder(s: Settings): Promise<ClipEncoder | { reason: string }> {
    if (this.opts.encoder) return this.opts.encoder(s)
    if (this.found && Date.now() - this.found.at < 10 * 60000) return this.found.enc
    let enc: ClipEncoder | { reason: string }
    if (s.mode === 'bundle' && s.stack) {
      const root = s.stack.hostRoot
      enc = { where: 'with Jellyfin’s own ffmpeg, inside its container', encode: (args, out) => this.host.ffmpeg(args, out, root) }
    } else if (this.opts.docker) {
      const jf = await findJellyfin(this.opts.docker, s, await this.opts.self?.()).catch((e) => ({ reason: `Finesse couldn’t look for Jellyfin’s container (${(e as Error).message}).` }))
      enc = 'reason' in jf ? jf : adoptEncoder(this.opts.docker, jf, await this.ffmpegPath(s), this.paths.previews)
    } else {
      enc = { reason: 'Preview clips need Jellyfin in Docker on this server (or a server Finesse set up), so Finesse can use Jellyfin’s ffmpeg.' }
    }
    this.found = { at: Date.now(), enc }
    return enc
  }

  /** Jellyfin's ffmpeg, as its own settings name it. */
  private async ffmpegPath(s: Settings): Promise<string> {
    try {
      const r = await fetch(`${s.jellyfin.url!.replace(/\/+$/, '')}${s.jellyfin.basePath}/System/Configuration/encoding`, {
        headers: { Authorization: `MediaBrowser Token="${s.jellyfin.apiKey}"` },
        signal: AbortSignal.timeout(10000),
      })
      const e = r.ok ? ((await r.json()) as { EncoderAppPathDisplay?: string; EncoderAppPath?: string }) : {}
      const p = e.EncoderAppPathDisplay || e.EncoderAppPath
      if (p && p.startsWith('/')) return p
    } catch {
      /* the usual place */
    }
    return JELLYFIN_FFMPEG
  }

  private block(reason: string) {
    this.status = { ...this.status, state: 'blocked', reason }
  }

  /** One pass: tidy up, then make clips for titles that don't have them yet (bounded by time). */
  async run(budgetMs = 4 * 60000): Promise<ClipStatus> {
    const s = this.settings.get()
    this.status.enabled = s.previews?.enabled !== false
    if (!this.status.enabled) {
      this.status = { ...this.status, state: 'off', reason: null }
      return this.status
    }
    if (this.running) return this.status
    if (!s.jellyfin.url || !s.jellyfin.apiKey) {
      this.block('Finesse isn’t connected to Jellyfin yet.')
      return this.status
    }
    if (!this.idle()) return this.status
    this.running = true
    const until = Date.now() + budgetMs
    try {
      const dir = this.paths.previews
      try {
        mkdirSync(dir, { recursive: true })
        accessSync(dir, constants.W_OK)
        writeFileSync(join(dir, '.write-test'), '')
        rmSync(join(dir, '.write-test'), { force: true })
      } catch {
        this.block(`Finesse can’t write to its previews folder (${dir}). It may be mounted read-only: give Finesse’s container that folder with write access, and clips can be made.`)
        return this.status
      }
      try {
        chownSync(dir, Number(process.env.PUID ?? 1000), Number(process.env.PGID ?? 1000))
      } catch {
        /* not root (dev): the folder is already ours */
      }
      let all: Item[]
      try {
        all = await this.items(s)
      } catch (e) {
        this.block(`Finesse couldn’t read the list of titles from Jellyfin (${(e as Error).message}). It tries again in a few minutes.`)
        return this.status
      }
      // A complete listing: clips of titles that left (or whose id changed) go, carefully (pruneOrphans).
      const ids = new Set(all.map((i) => i.Id.toLowerCase()))
      const stateFile = join(dir, '.prune.json')
      let prev: PruneState = {}
      try {
        prev = JSON.parse(readFileSync(stateFile, 'utf8')) as PruneState
      } catch {
        /* first run */
      }
      const prune = pruneOrphans(readdirSync(dir), ids, prev)
      const gone = prune.remove
      for (const n of gone) rmSync(join(dir, n), { force: true })
      if (gone.length) log.info(`removed ${gone.length} clip${gone.length > 1 ? 's' : ''} of titles Jellyfin no longer has`)
      if (prune.skipped && ids.size) log.info(`Jellyfin lists ${ids.size} titles, over a tenth fewer than last time: no clips removed this run`)
      writeFileSync(join(dir, '.prune.tmp'), JSON.stringify(prune.next))
      renameSync(join(dir, '.prune.tmp'), stateFile)
      for (const n of readdirSync(dir)) if (n.endsWith('.part')) rmSync(join(dir, n), { force: true })
      this.writeManifests()

      const items = all.filter((i) => i.Path && i.RunTimeTicks)
      const have = new Set(readdirSync(dir).filter((n) => n.endsWith('.mp4')))
      const missing = items.filter((i) => !have.has(`${i.Id}.mp4`))
      const todo = missing.filter((i) => (this.failed.get(i.Id) ?? 0) < 2)
      this.status = {
        ...this.status,
        state: todo.length ? 'making' : 'idle',
        reason: null,
        total: items.length,
        made: items.length - missing.length,
        pending: todo.length,
        failed: missing.length - todo.length,
        removed: gone.length,
        lastRun: new Date().toISOString(),
      }
      if (!todo.length) return this.status
      const wait = this.opts.waitFor?.() ?? null
      if (wait) {
        this.status = { ...this.status, state: 'idle', reason: wait }
        return this.status
      }
      const enc = await this.encoder(s)
      if ('reason' in enc) {
        this.status.where = null
        this.block(enc.reason)
        return this.status
      }
      this.status.where = enc.where
      for (const it of todo) {
        if (Date.now() > until || !this.idle()) break
        const height = Math.max(0, ...(it.MediaStreams ?? []).filter((m) => m.Type === 'Video').map((m) => m.Height ?? 0))
        const tiers: [number, number, string][] = [[480, 30, `${it.Id}.mp4`]]
        if (height >= 720) tiers.push([720, 26, `${it.Id}.720.mp4`])
        if (height >= 1080) tiers.push([1080, 24, `${it.Id}.1080.mp4`])
        let ok = true
        for (const [h, crf, out] of tiers) {
          if (have.has(out)) continue
          ok = (await this.encode(enc, it, h, crf, out)) && ok
          if (!ok) break
        }
        if (ok) this.status.made++
        else {
          const n = (this.failed.get(it.Id) ?? 0) + 1
          this.failed.set(it.Id, n)
          if (n >= 2) this.status.failed++
        }
        this.status.pending = Math.max(0, this.status.pending - 1)
      }
      this.writeManifests()
      if (!this.status.pending) this.status.state = 'idle'
      return this.status
    } finally {
      this.running = false
    }
  }

  private async encode(enc: ClipEncoder, it: Item, h: number, crf: number, out: string): Promise<boolean> {
    const dur = Math.floor((it.RunTimeTicks ?? 0) / 1e7)
    const src = it.Path!
    const codec = ['-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart']
    const single = (off: number) => ['-nostdin', '-y', '-loglevel', 'error', '-ss', String(off), '-i', src, '-t', '20', '-vf', `scale=-2:${h}`, ...codec]
    // Movies: 20 s from a fifth of the way in (the opening credits are rarely a good preview).
    const tries = [single(dur > 150 ? Math.max(30, Math.floor(dur / 5)) : Math.floor(dur / 10))]
    if (it.Type === 'Episode' && dur >= 120) {
      const cuts = [12, 24, 36, 48].map((p) => Math.floor((dur * p) / 100))
      const ins = cuts.flatMap((c) => ['-ss', String(c), '-t', '5', '-i', src])
      const chains = cuts
        .map((_, i) => `[${i}:v:0]scale=-2:${h},setsar=1,fps=24,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=4.6:d=0.4,setpts=PTS-STARTPTS[v${i}];[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.4,afade=t=out:st=4.6:d=0.4,asetpts=PTS-STARTPTS[a${i}];`)
        .join('')
      const pairs = cuts.map((_, i) => `[v${i}][a${i}]`).join('')
      // The teaser first; a single cut from later on if the source won't split.
      tries.unshift(['-nostdin', '-y', '-loglevel', 'error', ...ins, '-filter_complex', `${chains}${pairs}concat=n=4:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', ...codec])
      tries[1] = single(Math.max(30, Math.floor(dur / 5)))
    }
    let output = ''
    for (const args of tries) {
      const r = await enc.encode(args, out, src).catch((e) => ({ file: null, output: String(e) }))
      if (r.file) {
        const dest = join(this.paths.previews, out)
        try {
          renameSync(r.file, dest)
        } catch {
          // Another filesystem (Jellyfin's folder → Finesse's): copy, then tidy up.
          copyFileSync(r.file, dest)
          rmSync(r.file, { force: true })
        }
        return true
      }
      output = r.output
    }
    log.debug(`clip failed for ${it.Id}: ${output.slice(-200)}`)
    return false
  }

  /** manifest.json (ids with a base clip) + manifest-hd.json ({id: [720, 1080]}), from the folder (writeManifestFiles). */
  private writeManifests() {
    writeManifestFiles(this.paths.previews)
  }
}
