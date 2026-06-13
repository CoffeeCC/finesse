import { useParams } from 'react-router-dom'
import { useItem, usePersonItems } from '../api/queries'
import { imageUrl } from '../api/client'
import MediaCard from '../components/MediaCard'
import { CardSkeleton } from '../components/Skeletons'

export default function PersonPage() {
  const { personId } = useParams()
  const { data: person, isLoading } = useItem(personId)
  const { data: items, isLoading: itemsLoading } = usePersonItems(personId)

  if (isLoading || !person) {
    return <div className="h-[40vh] shimmer -mt-16" />
  }

  const headshot = person.ImageTags?.Primary
    ? imageUrl(person.Id, 'Primary', { maxWidth: 400, tag: person.ImageTags.Primary })
    : null

  return (
    <div className="pb-16">
      <div className="px-4 sm:px-6 lg:px-12 pt-8 flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">
        <div className="h-40 w-40 shrink-0 rounded-2xl overflow-hidden bg-ink-800 ring-1 ring-white/10 shadow-2xl">
          {headshot ? (
            <img src={headshot} alt={person.Name} className="h-full w-full object-cover fade-in" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-5xl font-bold text-ink-400">
              {person.Name.charAt(0)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-white tracking-tight">{person.Name}</h1>
          {items && (
            <p className="mt-1 text-sm text-ink-400">
              {items.TotalRecordCount} title{items.TotalRecordCount === 1 ? '' : 's'} in your library
            </p>
          )}
          {person.Overview && (
            <p className="mt-4 text-sm leading-relaxed text-ink-200 line-clamp-6 max-w-3xl">
              {person.Overview}
            </p>
          )}
        </div>
      </div>

      <section className="mt-10 px-4 sm:px-6 lg:px-12">
        <h2 className="text-lg font-semibold text-white tracking-tight mb-4">In your library</h2>
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
        >
          {itemsLoading
            ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
            : items?.Items.map((item) => <MediaCard key={item.Id} item={item} />)}
          {!itemsLoading && items?.Items.length === 0 && (
            <p className="col-span-full text-ink-400 py-8 text-center">
              Nothing from {person.Name} in your library yet.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
