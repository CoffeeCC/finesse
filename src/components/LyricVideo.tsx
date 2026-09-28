import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAudio } from '../audio/AudioPlayerContext'
import { useTrackLyrics } from '../api/queries'
import { ticksToSeconds, type JfItem } from '../api/types'
import type { LyricLine, TrackLyrics } from '../lib/lyrics'
import { getPrefs } from '../lib/settings'
import { blurhashPalette } from '../lib/blurhash'
import { IS_TV } from '../lib/device'
import { artBlurhash, artistOf, trackArt } from '../lib/music'

// The "Lyric video" visualizer: the song's synced lyrics set as kinetic type
// over generative visuals in the album's own colours — the kind of lyric video
// people cut for YouTube, made live from the music.
//
//   visuals  canvas: drifting colour fields from the cover's palette, a bass
//            glow with shockwave rings on the beat, rising light motes. Drawn at
//            reduced resolution (the fields are soft anyway) so TVs keep up.
//   words    DOM text (real type, the display face): each line gets a layout —
//            centred, stacked, or one giant word — and words reveal in time,
//            spread across the line by length. The key word takes the colour.
//   timing   its own clock, extrapolated between the player's ~4 Hz updates,
//            so reveals land on the beat rather than in 250 ms steps.

type Layout = 'center' | 'stack' | 'spot'

interface TimedWord {
  w: string
  at: number
  key: boolean
}
interface TimedLine {
  start: number
  end: number
  text: string
  words: TimedWord[]
  layout: Layout
}

const REDUCED = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A word without surrounding punctuation. (Plain ranges, not Unicode property
 *  escapes: the TV build targets engines that predate them.) */
const bare = (w: string) => w.replace(/^[^0-9A-Za-z\u00C0-\uFFFF']+|[^0-9A-Za-z\u00C0-\uFFFF']+$/g, '')

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function timeLines(lines: LyricLine[], seed: string, duration: number): TimedLine[] {
  return lines.map((l, i) => {
    const start = l.start ?? 0
    const nextStart = lines[i + 1]?.start
    const end = nextStart ?? Math.min(start + 6, duration || start + 6)
    const parts = l.text.split(/\s+/).filter(Boolean)
    // The key word: the longest real word (5+ letters), in colour.
    let keyIdx = -1
    let best = 4
    parts.forEach((w, k) => {
      const n = bare(w).length
      if (n > best) {
        best = n
        keyIdx = k
      }
    })
    // Reveal across ~70% of the line (min 0.6 s), weighted by word length.
    const span = Math.max(0.6, Math.min(end - start, 8) * 0.7)
    const total = parts.reduce((n, w) => n + w.length + 1, 0) || 1
    let acc = 0
    const words = parts.map((w, k) => {
      const at = start + (span * acc) / total
      acc += w.length + 1
      return { w, at, key: k === keyIdx }
    })
    const pick = hashStr(`${seed}:${i}`) % 3
    const layout: Layout =
      parts.length > 7 ? 'center' : pick === 2 && keyIdx >= 0 ? 'spot' : pick === 1 && parts.length >= 2 ? 'stack' : 'center'
    return { start, end, text: l.text, words, layout }
  })
}

/** clamp(min, vw%, max) in px — computed here because CSS clamp() only
 *  arrived in Chromium 79 and the LG CX runs 68 (the type fell back to body size). */
const fit = (vw: number, minRem: number, pct: number, maxRem: number) =>
  `${Math.round(Math.min(maxRem * 16, Math.max(minRem * 16, (vw * pct) / 100)))}px`

function sizeFor(words: number, vw: number): string {
  if (words <= 2) return fit(vw, 3.2, 11, 10)
  if (words <= 4) return fit(vw, 2.8, 8, 7.5)
  if (words <= 7) return fit(vw, 2.3, 5.6, 5.5)
  return fit(vw, 1.9, 4.2, 4)
}

function useViewportWidth(): number {
  const [vw, setVw] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vw
}

function Line({ line, leaving, vw }: { line: TimedLine; leaving?: boolean; vw: number }) {
  const n = line.words.length
  const cls = `lv-line absolute inset-0 flex px-[calc(var(--vw)*7)] ${leaving ? 'leaving' : ''}`
  const word = (tw: TimedWord, k: number, style?: CSSProperties) => (
    <span
      key={k}
      data-at={tw.at}
      className={`lv-word ${tw.key ? 'lv-key font-sans font-black uppercase tracking-tight' : 'font-display'}`}
      style={style}
    >
      {tw.w}
    </span>
  )
  if (line.layout === 'stack') {
    return (
      <div className={`${cls} items-center justify-start`}>
        <div className="flex flex-col items-start leading-[0.92]">
          {line.words.map((tw, k) =>
            word(tw, k, { fontSize: tw.key ? sizeFor(1, vw) : sizeFor(3, vw), fontStyle: tw.key ? undefined : k % 2 ? 'italic' : undefined }),
          )}
        </div>
      </div>
    )
  }
  if (line.layout === 'spot') {
    const key = line.words.find((w) => w.key)!
    return (
      <div className={`${cls} items-center justify-center text-center`}>
        <span aria-hidden className="lv-ghost absolute inset-x-0 top-1/2 -translate-y-1/2 font-sans font-black uppercase tracking-tighter leading-none">
          {bare(key.w)}
        </span>
        <p className="relative leading-[1.02]" style={{ fontSize: sizeFor(n, vw) }}>
          {line.words.map((tw, k) => word(tw, k))}
        </p>
      </div>
    )
  }
  return (
    <div className={`${cls} items-center justify-center text-center`}>
      <p className="leading-[1.02] max-w-[16ch]" style={{ fontSize: sizeFor(n, vw), maxWidth: n > 7 ? '24ch' : undefined }}>
        {line.words.map((tw, k) => word(tw, k))}
      </p>
    </div>
  )
}

/** Why there's nothing to set in motion, as a line for the title card. */
function noSyncReason(data: TrackLyrics | null | undefined, failed: boolean): string {
  if (data?.instrumental) return 'Instrumental'
  if (data?.lines.length) return 'The lyrics for this song aren’t timed — enjoy the visuals'
  if (failed) return 'Couldn’t look up lyrics just now — enjoy the visuals'
  if (!getPrefs().onlineLyrics) return 'Turn on “Find lyrics online” in Settings → Sound to look them up'
  return 'No synced lyrics found for this song — enjoy the visuals'
}

export default function LyricVideo({ track }: { track: JfItem }) {
  const { getAnalyser, position, playing, duration } = useAudio()
  const { data, isLoading, isError } = useTrackLyrics(track)
  const lines = useMemo(
    () => (data?.synced ? timeLines(data.lines, track.Id, duration || ticksToSeconds(track.RunTimeTicks)) : []),
    [data, track.Id, track.RunTimeTicks, duration],
  )
  const palette = useMemo(() => {
    const p = blurhashPalette(artBlurhash(track), 3)
    return p.length ? p : ([[117, 137, 216], [214, 110, 170], [90, 200, 220]] as [number, number, number][])
  }, [track])

  const vw = useViewportWidth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // Our own clock between the player's timeupdates.
  const clock = useRef({ pos: position, at: performance.now(), playing })
  useEffect(() => {
    clock.current = { pos: position, at: performance.now(), playing }
  }, [position, playing])

  // What's on stage: the title card (before the first line / after the last /
  // no synced lyrics), an interlude (empty line), or line `idx`.
  const [scene, setScene] = useState<{ kind: 'card' | 'interlude' | 'line'; idx: number }>({ kind: 'card', idx: -1 })
  const [leaving, setLeaving] = useState<number | null>(null)
  const sceneRef = useRef(scene)
  sceneRef.current = scene

  useEffect(() => {
    setScene({ kind: 'card', idx: -1 })
    setLeaving(null)
  }, [track.Id])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const SCALE = IS_TV ? 0.35 : 0.5
    let w = 0
    let h = 0
    const resize = () => {
      w = canvas.width = Math.max(2, Math.round(canvas.clientWidth * SCALE))
      h = canvas.height = Math.max(2, Math.round(canvas.clientHeight * SCALE))
    }
    resize()
    window.addEventListener('resize', resize)

    let analyser = getAnalyser()
    let freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    let energy = 0
    let avgBass = 0.3
    let pulse = 0
    let lastBeat = 0
    const rings: { r: number; a: number; c: number }[] = []
    const MOTES = IS_TV ? 36 : 70
    const motes = Array.from({ length: MOTES }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      s: 0.6 + Math.random() * 1.4,
      p: i * 1.7,
    }))
    const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
    let raf = 0
    let leaveTimer = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const secs = now / 1000
      const c = clock.current
      const t = c.playing ? c.pos + (now - c.at) / 1000 : c.pos

      // --- audio energy + beats ---
      if (!analyser) {
        analyser = getAnalyser()
        if (analyser) freq = new Uint8Array(analyser.frequencyBinCount)
      }
      let bass = 0
      let mid = 0
      if (analyser && freq && c.playing) {
        analyser.getByteFrequencyData(freq)
        bass = (freq[1] + freq[2] + freq[3] + freq[4] + freq[5]) / 5 / 255
        let m = 0
        for (let i = 12; i < 48; i++) m += freq[i]
        mid = m / 36 / 255
      } else if (c.playing) {
        // No analyser (older engines / CORS): a gentle synthetic pulse.
        bass = 0.35 + 0.25 * Math.max(0, Math.sin(secs * 4.2))
        mid = 0.3
      }
      energy = energy * 0.85 + bass * 0.15
      avgBass = avgBass * 0.985 + bass * 0.015
      if (!REDUCED && bass > 0.32 && bass > avgBass * 1.3 && now - lastBeat > 280) {
        lastBeat = now
        pulse = 1
        rings.push({ r: Math.min(w, h) * 0.08, a: 0.55, c: rings.length % palette.length })
      }
      pulse *= 0.9
      stageRef.current?.style.setProperty('--beat', pulse.toFixed(3))

      // --- visuals ---
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#06070b'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'screen'
      const drift = REDUCED ? 0.3 : 1
      const m = Math.min(w, h)
      for (let i = 0; i < 4; i++) {
        const col = palette[i % palette.length]
        const x = w * (0.5 + 0.36 * Math.sin(secs * 0.07 * drift * (i + 1) + i * 2.1))
        const y = h * (0.5 + 0.3 * Math.cos(secs * 0.05 * drift * (i + 2) + i * 1.3))
        const r = m * (0.55 + 0.12 * Math.sin(secs * 0.11 + i)) * (1 + energy * 0.35)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, rgba(col, 0.42 + energy * 0.2))
        g.addColorStop(1, rgba(col, 0))
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      // Bass glow at the centre
      const gl = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, m * (0.35 + energy * 0.4))
      gl.addColorStop(0, rgba(palette[0], 0.18 + pulse * 0.25))
      gl.addColorStop(1, rgba(palette[0], 0))
      ctx.fillStyle = gl
      ctx.fillRect(0, 0, w, h)
      // Shockwave rings
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i]
        ring.r += m * (0.012 + energy * 0.02)
        ring.a *= 0.955
        if (ring.a < 0.02) {
          rings.splice(i, 1)
          continue
        }
        ctx.strokeStyle = rgba(palette[ring.c], ring.a)
        ctx.lineWidth = Math.max(1, m * 0.006)
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, ring.r, 0, Math.PI * 2)
        ctx.stroke()
      }
      // Light motes, rising faster with the mids
      ctx.globalCompositeOperation = 'lighter'
      for (const p of motes) {
        p.y -= (0.0006 + mid * 0.004) * p.s * drift
        p.x += Math.sin(secs * 0.6 + p.p) * 0.0003
        if (p.y < -0.02) {
          p.y = 1.02
          p.x = Math.random()
        }
        const a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(secs * 2 + p.p))
        ctx.fillStyle = `rgba(255,255,255,${(a * 0.6).toFixed(3)})`
        const s = Math.max(1, p.s * m * 0.004)
        ctx.fillRect(p.x * w, p.y * h, s, s)
      }

      // --- words ---
      let next: { kind: 'card' | 'interlude' | 'line'; idx: number } = { kind: 'card', idx: -1 }
      if (lines.length) {
        let idx = -1
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].start <= t + 0.05) idx = i
          else break
        }
        if (idx >= 0) {
          const ln = lines[idx]
          next = t > ln.end + 0.5 ? { kind: 'card', idx: -1 } : ln.words.length ? { kind: 'line', idx } : { kind: 'interlude', idx }
        }
      }
      const cur = sceneRef.current
      if (next.kind !== cur.kind || next.idx !== cur.idx) {
        if (cur.kind === 'line') {
          setLeaving(cur.idx)
          window.clearTimeout(leaveTimer)
          leaveTimer = window.setTimeout(() => setLeaving(null), 700)
        }
        sceneRef.current = next
        setScene(next)
      }
      const stage = stageRef.current
      if (stage) {
        const words = stage.querySelectorAll<HTMLElement>('.lv-line:not(.leaving) .lv-word')
        for (let i = 0; i < words.length; i++) {
          const on = Number(words[i].dataset.at) <= t + 0.04
          if (on !== words[i].classList.contains('on')) words[i].classList.toggle('on', on)
        }
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(leaveTimer)
      window.removeEventListener('resize', resize)
    }
  }, [getAnalyser, lines, palette])

  const key = palette[1] ?? palette[0]
  const cover = trackArt(track, 600)
  const stageStyle = {
    '--lv-key': `rgb(${key[0]}, ${key[1]}, ${key[2]})`,
    '--lv-key-rgb': `${key[0]}, ${key[1]}, ${key[2]}`,
  } as CSSProperties

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#06070b]" aria-label="Lyric video">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <div aria-hidden className="lv-vignette absolute inset-0" />
      <div ref={stageRef} className="lv-stage absolute inset-0 text-white" style={stageStyle} aria-live="off">
        {scene.kind === 'card' && (
          <div key={`card-${track.Id}`} className="lv-card absolute inset-0 flex flex-col items-center justify-center text-center px-8">
            {cover && <img src={cover} alt="" className="h-[calc(var(--vh)*26)] w-[calc(var(--vh)*26)] rounded-2xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/15" />}
            <p className="mt-8 font-display leading-[0.95]" style={{ fontSize: fit(vw, 2.6, 7, 6.5) }}>
              {track.Name}
            </p>
            <p className="mt-4 text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-white/70">{artistOf(track)}</p>
            {!isLoading && !lines.length && (
              <p className="mt-6 text-sm text-white/45">{noSyncReason(data, isError)}</p>
            )}
          </div>
        )}
        {scene.kind === 'interlude' && (
          <div key={`gap-${scene.idx}`} className="lv-card absolute inset-0 flex items-center justify-center">
            <span className="lv-note font-display text-white/70" style={{ fontSize: fit(vw, 4, 12, 9) }}>
              ♪
            </span>
          </div>
        )}
        {leaving != null && lines[leaving] && <Line key={`out-${leaving}`} line={lines[leaving]} leaving vw={vw} />}
        {scene.kind === 'line' && lines[scene.idx] && <Line key={`in-${scene.idx}`} line={lines[scene.idx]} vw={vw} />}
      </div>
    </div>
  )
}
