import { useQuery } from '@tanstack/react-query'
import { getPeerLatest } from '../api/client'
import { useFriends } from '../api/queries'
import type { Friend } from '../api/setup'
import MediaRow from './MediaRow'

// Home is for watching: a friend's newest albums are on the Music and Friends pages.
const WATCHABLE = new Set(['Movie', 'Series', 'Season', 'Episode', 'Video', 'BoxSet'])

function FriendRow({ friend }: { friend: Friend }) {
  const { data, isLoading } = useQuery({
    queryKey: ['friend', friend.id, 'latest'],
    queryFn: async () => (await getPeerLatest(friend.id, 40)).filter((i) => WATCHABLE.has(i.Type)).slice(0, 24),
    staleTime: 5 * 60_000,
    retry: false,
  })
  return <MediaRow title={`From ${friend.name}`} items={data} loading={isLoading} seeAllHref="/friends" minItems={1} />
}

/** Home: one row per friend's server (Groups), after our own rows. */
export default function FriendRows() {
  const { data: friends } = useFriends()
  return <>{friends?.map((f) => <FriendRow key={f.id} friend={f} />)}</>
}
