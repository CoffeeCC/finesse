// Preview clips for hover previews and the detail hero: a short 480p clip per
// movie (plus 720p/1080p tiers when the source has them) and, for episodes, a
// spoiler-light "next time on…" teaser of four 5-second cuts from the first
// half. ffmpeg runs inside the Jellyfin container (it can read the library)
// at the lowest CPU priority, one item at a time, so it never gets in the way
// of anyone watching. Incremental: finished clips are skipped, so a big
// library fills in over a few quiet hours. Manifests match deploy/genclips.sh.

import { chownSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Paths, SettingsStore } from '../config.ts'
import { logger } from '../log.ts'
import { containerName } from './catalog.ts'
import type { Docker } from './docker.ts'

const log = logger('clips')
const FF = '/usr/lib/jellyfin-ffmpeg/ffmpeg'
const STAGE_IN = '/config/finesse-previews' // inside the Jellyfin container

interface Item {
  Id: string
  Type: 'Movie' | 'Episode'
  Path?: string
  RunTimeTicks?: number
  MediaStreams?: { Type: string; Height?: number }[]
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export class ClipMaker {
  private running = false
  private timer: NodeJS.Timeout | null = null
  private failed = new Map<string, number>()
  readonly settings: SettingsStore
  readonly docker: Docker
  readonly paths: Paths
  private readonly idle: () => boolean
  status = { made: 0, pending: 0, total: 0, lastRun: null as string | null }

  constructor(settings: SettingsStore, docker: Docker, paths: Paths, idle: () => boolean) {
    this.settings = settings
    this.docker = docker
    this.paths = paths
    this.idle = idle
  }

  start(everyMs = 5 * 60000) {
    if (this.timer) return
    const go = () => void this.run().catch((e) => log.warn('clip run failed', e))
    setTimeout(go, 90000).unref()
    this.timer = setInterval(go, everyMs)
    this.timer.unref()
  }

  /** Staging folder on the host (Jellyfin's /config/finesse-previews). */
  private stageHost(): string | null {
    const root = this.settings.get().stack?.hostRoot
    return root ? join(root, 'config', 'jellyfin', 'finesse-previews') : null
  }

  private async items(): Promise<Item[]> {
    const s = this.settings.get()
    const base = `${s.jellyfin.url!.replace(/\/+$/, '')}${s.jellyfin.basePath}`
    const r = await fetch(`${base}/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Fields=Path,MediaStreams&EnableImages=false&EnableUserData=false`, {
      headers: { Authorization: `MediaBrowser Token="${s.jellyfin.apiKey}"` },
      signal: AbortSignal.timeout(60000),
    })
    if (!r.ok) throw new Error(`Jellyfin answered ${r.status}`)
    return ((await r.json()) as { Items: Item[] }).Items.filter((i) => i.Path && i.RunTimeTicks)
  }

  /** One pass: make clips for items that don't have them yet (bounded by time). */
  async run(budgetMs = 4 * 60000): Promise<void> {
    const s = this.settings.get()
    if (this.running || s.mode !== 'bundle' || !s.stack || !s.jellyfin.apiKey || s.previews?.enabled === false || !this.idle()) return
    const stage = this.stageHost()
    if (!stage) return
    this.running = true
    const until = Date.now() + budgetMs
    try {
      mkdirSync(this.paths.previews, { recursive: true })
      mkdirSync(stage, { recursive: true })
      // Made by Finesse (root): hand them to the stack's user, or Jellyfin
      // (running as PUID) can't write its clips there and none get made.
      for (const dir of [this.paths.previews, stage]) {
        try {
          chownSync(dir, Number(process.env.PUID ?? 1000), Number(process.env.PGID ?? 1000))
        } catch {
          /* not root (dev): the folders are already ours */
        }
      }
      const items = await this.items()
      const have = new Set(readdirSync(this.paths.previews).filter((n) => n.endsWith('.mp4')))
      const todo = items.filter((i) => !have.has(`${i.Id}.mp4`) && (this.failed.get(i.Id) ?? 0) < 2)
      this.status = { ...this.status, total: items.length, pending: todo.length, lastRun: new Date().toISOString() }
      for (const it of todo) {
        if (Date.now() > until || !this.idle()) break
        const height = Math.max(0, ...(it.MediaStreams ?? []).filter((m) => m.Type === 'Video').map((m) => m.Height ?? 0))
        const tiers: [number, number, string][] = [[480, 30, `${it.Id}.mp4`]]
        if (height >= 720) tiers.push([720, 26, `${it.Id}.720.mp4`])
        if (height >= 1080) tiers.push([1080, 24, `${it.Id}.1080.mp4`])
        let ok = true
        for (const [h, crf, out] of tiers) {
          if (have.has(out)) continue
          ok = (await this.encode(it, h, crf, out, stage)) && ok
          if (!ok) break
        }
        if (ok) this.status.made++
        else this.failed.set(it.Id, (this.failed.get(it.Id) ?? 0) + 1)
        this.status.pending = Math.max(0, this.status.pending - 1)
      }
      // Forget clips of titles that left the library.
      const ids = new Set(items.map((i) => i.Id))
      for (const n of readdirSync(this.paths.previews)) {
        const id = n.split('.')[0]!
        if (n.endsWith('.mp4') && !ids.has(id)) rmSync(join(this.paths.previews, n), { force: true })
      }
      this.writeManifests()
    } finally {
      this.running = false
    }
  }

  private async encode(it: Item, h: number, crf: number, out: string, stage: string): Promise<boolean> {
    const dur = Math.floor((it.RunTimeTicks ?? 0) / 1e7)
    const src = q(it.Path!)
    const enc = `-c:v libx264 -crf ${crf} -preset veryfast -profile:v high -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart ${STAGE_IN}/${out}`
    const single = (off: number) => `nice -n 19 ${FF} -nostdin -y -loglevel error -ss ${off} -i ${src} -t 20 -vf scale=-2:${h} ${enc}`
    let cmd: string
    if (it.Type === 'Episode' && dur >= 120) {
      const cuts = [12, 24, 36, 48].map((p) => Math.floor((dur * p) / 100))
      const ins = cuts.map((c) => `-ss ${c} -t 5 -i ${src}`).join(' ')
      const chains = cuts
        .map((_, i) => `[${i}:v:0]scale=-2:${h},setsar=1,fps=24,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=4.6:d=0.4,setpts=PTS-STARTPTS[v${i}];[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.4,afade=t=out:st=4.6:d=0.4,asetpts=PTS-STARTPTS[a${i}];`)
        .join('')
      const pairs = cuts.map((_, i) => `[v${i}][a${i}]`).join('')
      cmd = `nice -n 19 ${FF} -nostdin -y -loglevel error ${ins} -filter_complex ${q(`${chains}${pairs}concat=n=4:v=1:a=1[v][a]`)} -map '[v]' -map '[a]' ${enc} || ${single(Math.max(30, Math.floor(dur / 5)))}`
    } else {
      // Movies: 20 s from a fifth of the way in (the opening credits are rarely a good preview).
      cmd = single(dur > 150 ? Math.max(30, Math.floor(dur / 5)) : Math.floor(dur / 10))
    }
    const r = await this.docker.exec(containerName('jellyfin'), ['sh', '-c', `mkdir -p ${STAGE_IN} && (${cmd})`]).catch((e) => ({ code: -1, output: String(e) }))
    const staged = join(stage, out)
    if (r.code === 0 && existsSync(staged) && statSync(staged).size > 0) {
      renameSync(staged, join(this.paths.previews, out))
      return true
    }
    rmSync(staged, { force: true })
    log.debug(`clip failed for ${it.Id}: ${r.output.slice(-200)}`)
    return false
  }

  /** manifest.json (ids with a base clip) + manifest-hd.json ({id: [720, 1080]}). */
  private writeManifests() {
    const names = readdirSync(this.paths.previews).filter((n) => n.endsWith('.mp4'))
    const base = names.filter((n) => !/\.(720|1080)\.mp4$/.test(n)).map((n) => n.slice(0, -4))
    const hd: Record<string, number[]> = {}
    for (const n of names) {
      const m = /^(.+)\.(720|1080)\.mp4$/.exec(n)
      if (m) (hd[m[1]!] ??= []).push(Number(m[2]))
    }
    const write = (file: string, data: unknown) => {
      const tmp = join(this.paths.previews, `.${file}.tmp`)
      writeFileSync(tmp, JSON.stringify(data))
      renameSync(tmp, join(this.paths.previews, file))
    }
    write('manifest.json', base)
    write('manifest-hd.json', hd)
  }
}
