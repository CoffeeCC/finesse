import { useSearchParams } from 'react-router-dom'
import SearchPanel from '../components/SearchPanel'

/** The Search tab on phones and the TV (desktop mostly uses the "/" overlay,
 *  but deep links like /search?q= land here too). */
export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const term = searchParams.get('q') ?? ''

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-12 py-6 max-w-5xl">
      <h1 className="page-title mb-4">Search</h1>
      <SearchPanel
        mode="page"
        initialQuery={term}
        onQueryChange={(q) => {
          if (q !== term) setSearchParams(q ? { q } : {}, { replace: true })
        }}
      />
    </div>
  )
}
