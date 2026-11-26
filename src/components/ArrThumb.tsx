import { useMemo, useState } from 'react'
import { arrCoverUrl, type ArrKind } from '../api/arr'

const SIZES = {
  sm: { poster: 'w-11 h-16 rounded-md', artist: 'w-14 h-14 rounded-full', text: 'text-sm' },
  md: { poster: 'w-20 h-30 rounded-lg', artist: 'w-20 h-20 rounded-full', text: 'text-xl' },
} as const

function hue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

const SMALL = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to'])

function initials(title: string): string {
  const all = title.split(/\s+/).filter((w) => /\w/.test(w))
  const big = all.filter((w) => !SMALL.has(w.toLowerCase()))
  const words = big.length ? big : all
  return words.slice(0, 2).map((w) => w.replace(/^\W+/, '')[0]?.toUpperCase() ?? '').join('') || '?'
}

/** A poster or artist picture from Radarr/Sonarr/Lidarr. Tries the copy the app
 *  keeps (for anything in the library), then the web's, then shows the title's
 *  initials: never the browser's broken-image icon. Artists are round. */
export default function ArrThumb({ kind, id, remote, title, size = 'sm' }: { kind: ArrKind; id?: number; remote?: string; title: string; size?: keyof typeof SIZES }) {
  const srcs = useMemo(() => [id && id > 0 ? arrCoverUrl(kind, id) : undefined, remote].filter((s): s is string => Boolean(s)), [kind, id, remote])
  const [failed, setFailed] = useState<readonly string[]>([])
  const src = srcs.find((s) => !failed.includes(s))
  const h = useMemo(() => hue(title), [title])
  const box = `${SIZES[size][kind === 'artist' ? 'artist' : 'poster']} shrink-0 overflow-hidden`

  if (!src) {
    return (
      <div
        className={`${box} flex items-center justify-center`}
        style={{ backgroundImage: `linear-gradient(150deg, hsl(${h}, 45%, 34%), hsl(${(h + 40) % 360}, 50%, 16%))` }}
        aria-hidden
      >
        <span className={`${SIZES[size].text} font-bold tracking-tight text-white/85`}>{initials(title)}</span>
      </div>
    )
  }
  return (
    <div className={`${box} bg-ink-800`}>
      <img
        key={src}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        // A copy that answers but is empty (0×0) is as broken as one that errors.
        onLoad={(e) => e.currentTarget.naturalWidth === 0 && setFailed((f) => (f.includes(src) ? f : [...f, src]))}
        onError={() => setFailed((f) => (f.includes(src) ? f : [...f, src]))}
      />
    </div>
  )
}
