import { Link } from 'react-router-dom'
import { useAlbums, useViews } from '../api/queries'
import { posterUrl } from '../api/client'
import { blurhashToDataURL, primaryBlurhash } from '../lib/blurhash'
import { CardSkeleton } from '../components/Skeletons'
import type { JfItem } from '../api/types'

function AlbumCard({ album }: { album: JfItem }) {
  const art = posterUrl(album, 360)
  const blur = blurhashToDataURL(primaryBlurhash(album))
  return (
    <Link to={`/album/${album.Id}`} className="group block outline-none">
      <div className="relative aspect-square rounded-xl overflow-hidden bg-ink-800 ring-1 ring-white/5 transition-all group-hover:ring-2 group-hover:ring-accent-400 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-black/50">
        {blur && <img src={blur} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />}
        {art ? (
          <img src={art} alt={album.Name} loading="lazy" className="relative h-full w-full object-cover fade-in" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-sm text-ink-400 p-3 text-center">
            {album.Name}
          </div>
        )}
      </div>
      <p className="mt-2 text-sm font-medium text-ink-200 truncate group-hover:text-white transition-colors">
        {album.Name}
      </p>
      <p className="text-xs text-ink-400 truncate">{album.AlbumArtist || album.ProductionYear || ''}</p>
    </Link>
  )
}

export default function MusicPage() {
  const { data: views } = useViews()
  const musicView = views?.Items.find((v) => v.CollectionType === 'music')
  const { data: albums, isLoading } = useAlbums(musicView?.Id)

  return (
    <div className="px-4 sm:px-6 lg:px-12 py-8">
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">Music</h1>
        {albums && <span className="text-sm text-ink-400">{albums.TotalRecordCount} albums</span>}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {isLoading
          ? Array.from({ length: 18 }).map((_, i) => <CardSkeleton key={i} />)
          : albums?.Items.map((a) => <AlbumCard key={a.Id} album={a} />)}
      </div>

      {!isLoading && albums?.Items.length === 0 && (
        <p className="text-ink-400 py-12 text-center">No albums in your music library.</p>
      )}
    </div>
  )
}
