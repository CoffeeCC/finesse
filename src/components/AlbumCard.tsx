import { Link } from 'react-router-dom'
import { posterUrl } from '../api/client'
import type { JfItem } from '../api/types'
import { blurhashToDataURL, primaryBlurhash } from '../lib/blurhash'
import { usePlayAlbum } from '../lib/playAlbum'

/** Square album tile; hovering it offers a play button that starts the album
 *  without opening it. */
export default function AlbumCard({ album, width }: { album: JfItem; width?: number }) {
  const art = posterUrl(album, 360)
  const blur = blurhashToDataURL(primaryBlurhash(album))
  const playAlbum = usePlayAlbum()
  const href = `/album/${album.Id}`
  return (
    <div className="group shrink-0 snap-start" style={width ? { width } : undefined}>
      <div className="relative">
        <Link
          to={href}
          className="block relative aspect-square rounded-xl overflow-hidden bg-ink-800 ring-1 ring-white/5 transition-all group-hover:ring-white/25 focus-visible:ring-2 focus-visible:ring-accent-400 outline-none shadow-lg shadow-black/30"
        >
          {blur && <img src={blur} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />}
          {art ? (
            <img src={art} alt={album.Name} loading="lazy" className="relative h-full w-full object-cover fade-in" />
          ) : (
            <span className="relative h-full w-full flex items-center justify-center text-sm text-ink-400 p-3 text-center">{album.Name}</span>
          )}
        </Link>
        {/* Sibling of the link (a button can't live inside an <a>); mouse-only. */}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => void playAlbum(album.Id)}
          aria-label={`Play ${album.Name}`}
          className="absolute right-2 bottom-2 h-11 w-11 rounded-full bg-white text-ink-950 shadow-xl shadow-black/40 flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-105 transition-all [@media(hover:none)]:hidden"
        >
          <svg className="h-5 w-5 translate-x-px" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
      <Link to={href} tabIndex={-1} className="block">
        <p className="mt-2 text-sm font-semibold text-ink-100 truncate group-hover:text-white transition-colors">{album.Name}</p>
        <p className="text-xs text-ink-400 truncate">{[album.AlbumArtist, album.ProductionYear].filter(Boolean).join(' · ')}</p>
      </Link>
    </div>
  )
}
