import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getLatest, getResume, getViews } from '../api/client'
import { useFriends } from '../api/queries'
import type { Friend } from '../api/setup'
import { useAuth } from '../auth/AuthContext'
import MediaRow from '../components/MediaRow'

const PAD = 'px-4 sm:px-6 lg:px-12'

/** One friend's server: what they're sharing, a row per library. */
function FriendServer({ friend }: { friend: Friend }) {
  const views = useQuery({ queryKey: ['friend', friend.id, 'views'], queryFn: () => getViews(friend.id), staleTime: 5 * 60_000, retry: 1 })
  const resume = useQuery({ queryKey: ['friend', friend.id, 'resume'], queryFn: () => getResume(friend.id), staleTime: 60_000, retry: false })
  const libs = (views.data?.Items ?? []).filter((v) => v.CollectionType !== 'music' && v.CollectionType !== 'playlists')

  return (
    <section className="space-y-6">
      <div className={PAD}>
        <h2 className="text-xl font-semibold text-white tracking-tight">{friend.name}</h2>
        <p className="text-[13px] text-ink-400">Shared with you. Streams come from their server, so the first seconds can take a little longer.</p>
      </div>
      {views.isError ? (
        <p className="mx-4 sm:mx-6 lg:mx-12 rounded-xl border border-white/5 bg-ink-900/50 px-4 py-3 text-sm text-ink-300">
          {friend.name} isn’t answering right now. It may be switched off, or no longer shared with you.
        </p>
      ) : (
        <>
          <MediaRow title="Continue watching" items={resume.data?.Items} variant="wide" />
          {views.isLoading ? <MediaRow title=" " items={undefined} loading /> : libs.map((lib) => <FriendLibraryRow key={lib.Id} viewId={lib.Id} title={lib.Name} />)}
          {!views.isLoading && !libs.length && <p className={`${PAD} text-sm text-ink-400`}>Nothing is shared with you yet.</p>}
        </>
      )}
    </section>
  )
}

function FriendLibraryRow({ viewId, title }: { viewId: string; title: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['latest', viewId], queryFn: () => getLatest(viewId, 24), staleTime: 5 * 60_000 })
  return <MediaRow title={title} items={data} loading={isLoading} seeAllHref={`/library/${viewId}`} />
}

/** Friends: libraries other households share with this one (Groups). */
export default function FriendsPage() {
  const { data: friends, isLoading } = useFriends()
  const { session } = useAuth()
  const none = !isLoading && !friends?.length

  return (
    <div className="pb-16 py-6 space-y-10">
      <div className={PAD}>
        <h1 className="text-3xl font-semibold text-white tracking-tight mb-1">Friends</h1>
        <p className="text-sm text-ink-400">Libraries friends share from their own Finesse. Watch only: nothing is downloaded or requested there.</p>
      </div>
      {none ? (
        <div className="mx-4 sm:mx-6 lg:mx-12 rounded-2xl border border-white/5 bg-ink-900/50 px-6 py-10 sm:p-12 text-center max-w-2xl">
          <p className="text-lg font-semibold text-white">No friends’ servers yet</p>
          <p className="text-sm text-ink-300 mt-1.5">
            When a friend who runs Finesse shares with this server, their libraries appear here.
            {session?.isAdmin ? ' Add one with the code they send you.' : ' Ask whoever runs this server to add one.'}
          </p>
          {session?.isAdmin && (
            <Link to="/settings#settings-groups" className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors">
              Set up Groups
            </Link>
          )}
        </div>
      ) : (
        (friends ?? []).map((f) => <FriendServer key={f.id} friend={f} />)
      )}
    </div>
  )
}
