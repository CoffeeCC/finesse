// A title, album or person page that couldn't load: say why, and offer Back (and
// Retry when trying again could help) instead of a loading shimmer that never ends.

import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { goBack } from '../lib/back'
import { isPeerId } from '../lib/peers'

type Kind = 'title' | 'album' | 'person'

const NOUN: Record<Kind, string> = { title: 'title', album: 'album', person: 'person' }

/** What to say for a failed load (null error: the server answered, but with nothing). */
export function unavailableCopy(kind: Kind, error: unknown, id?: string): { title: string; body: string; retry: boolean } {
  const noun = NOUN[kind]
  const status = error instanceof ApiError ? error.status : undefined
  if (id && isPeerId(id) && (status === 401 || status === 403 || status === 404)) {
    return { title: 'No longer shared with you', body: `The friend’s server that had this ${noun} has stopped sharing it, or isn’t reachable right now.`, retry: true }
  }
  if (status === 404 || (!error && status === undefined)) {
    return { title: `This ${noun} isn’t here any more`, body: `It may have been removed from the library, or moved. Search for it to find it again.`, retry: false }
  }
  if (status === 403) {
    return { title: `This ${noun} isn’t available to you`, body: `Your account can’t open the library it’s in. Ask whoever runs this server to share it with you.`, retry: false }
  }
  return { title: `Couldn’t load this ${noun}`, body: 'The server didn’t answer. Check your connection, then try again.', retry: true }
}

export default function ItemUnavailable({ kind, error, id, onRetry, retrying }: { kind: Kind; error: unknown; id?: string; onRetry: () => void; retrying?: boolean }) {
  const navigate = useNavigate()
  const copy = unavailableCopy(kind, error, id)
  return (
    <main className="px-4 sm:px-6 lg:px-12 py-16">
      <div role="alert" className="mx-auto max-w-lg text-center">
        <h1 className="font-display text-4xl text-white">{copy.title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-300">{copy.body}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            data-autofocus
            onClick={() => goBack(navigate)}
            className="inline-flex h-11 items-center rounded-full border border-white/15 bg-white/10 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-white/15"
          >
            Back
          </button>
          {copy.retry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex h-11 items-center rounded-full bg-white px-5 text-[15px] font-semibold text-ink-950 transition-colors hover:bg-ink-200 disabled:opacity-60"
            >
              {retrying ? 'Trying again…' : 'Try again'}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
