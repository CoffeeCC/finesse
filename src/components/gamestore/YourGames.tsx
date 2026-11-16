// Installed store games, on the Games page. A tile is the cover with the start-check
// picture over the lower half, when the install left one.

import { useState } from 'react'
import { libraryShotUrl, type LibraryGame } from '../../api/gameStore'
import { useGameRequestActions, useLibrary, useStoreMode } from '../../api/gameStoreQueries'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToast } from '../Toast'
import PlayChoice from './PlayChoice'
import { storeGradient } from './StoreCards'

export default function YourGames() {
  const mode = useStoreMode()
  const { data } = useLibrary()
  const actions = useGameRequestActions()
  const toast = useToast()
  const [play, setPlay] = useState<LibraryGame | null>(null)
  const [remove, setRemove] = useState<LibraryGame | null>(null)
  if (!mode || !data?.length) return null
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'That didn’t work', 'error')
  return (
    <section className="mb-9" aria-label="Your games">
      <h2 className="row-title mb-3 text-white">Your games</h2>
      <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pt-2 pb-2 no-scrollbar">
        {data.map((g) => {
          const warn = g.detail && /couldn['’]t be test-started/i.test(g.detail) ? 'Couldn’t be test-started on the server. Play still works.' : null
          return (
            <div key={g.id} className="w-40 shrink-0">
              <button type="button" onClick={() => setPlay(g)} className="own-focus group block w-full text-left outline-none">
                <Tile game={g} shot={g.shot ? libraryShotUrl(mode, g.id) : null} />
                <p className="mt-2 truncate px-0.5 text-sm font-medium text-ink-200 group-hover:text-white group-focus-visible:text-white">{g.title}</p>
              </button>
              {warn && <p className="mt-1 px-0.5 text-[12px] leading-snug text-amber-200">{warn}</p>}
              <button type="button" onClick={() => setRemove(g)} className="mt-1 rounded-md px-0.5 text-[13px] font-medium text-ink-400 hover:text-white focus-visible:text-white">
                Uninstall
              </button>
            </div>
          )
        })}
      </div>
      {play && <PlayChoice request={play} onClose={() => setPlay(null)} />}
      {remove && (
        <ConfirmDialog
          title={`Uninstall “${remove.title}”?`}
          confirmLabel="Uninstall"
          cancelLabel="Keep it"
          busy={actions.cancel.isPending}
          onCancel={() => setRemove(null)}
          onConfirm={() => actions.cancel.mutate(remove.id, { onError: fail, onSettled: () => setRemove(null) })}
        >
          The game is deleted from the server, with anything left of its download. You can request it again later.
        </ConfirmDialog>
      )}
    </section>
  )
}

function Tile({ game, shot }: { game: LibraryGame; shot: string | null }) {
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-ink-800">
      {game.cover ? (
        <img src={game.cover} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-end p-3" style={{ backgroundImage: storeGradient(game.gameId) }}>
          <span className="line-clamp-4 font-display text-[19px] leading-[1.02] text-white">{game.title}</span>
        </div>
      )}
      {shot && <img src={shot} alt="" className="absolute inset-x-0 bottom-0 h-1/2 w-full object-cover object-top" />}
    </div>
  )
}
