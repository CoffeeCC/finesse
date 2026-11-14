// Settings → Server → Game store (administrators): on or off, and where its games come from.
// Finesse ships no games: each source is a feed (docs/game-store-feed.md), at an address or as
// a file in the server's config folder.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { gameStoreAdmin, type StoreFeed, type StoreSettings } from '../../api/gameStore'
import { useToast } from '../../components/Toast'
import { discover } from '../../lib/finesseServer'
import { Spinner, Toggle } from '../setup/ui'

const CARD = 'rounded-2xl bg-ink-900/60 border border-white/5'
const smallBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-ink-200 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'
const field = 'h-9 min-w-0 rounded-lg border border-white/10 bg-ink-950/60 px-3 text-[13.5px] text-white placeholder:text-ink-500 outline-none focus:border-accent-400'

/** "12 games", "Couldn't be read", "Not read yet": one line per source. */
export function feedSummary(f: StoreFeed): { text: string; bad: boolean } {
  const s = f.status
  if (!s) return { text: 'Not read yet', bad: false }
  const games = `${s.games} game${s.games === 1 ? '' : 's'}`
  if (!s.ok) return { text: s.games ? `Couldn’t be read just now, so it’s still showing ${games} from last time` : 'Couldn’t be read', bad: true }
  return { text: s.notes.length ? `${games}, ${s.notes.length} left out` : games, bad: false }
}

export default function GameStoreAdmin() {
  const toast = useToast()
  const [s, setS] = useState<StoreSettings | null>(null)
  const [feeds, setFeeds] = useState<StoreFeed[]>([])
  const [busy, setBusy] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [open, setOpen] = useState('')

  const load = useCallback(async () => {
    try {
      const [settings, list] = await Promise.all([gameStoreAdmin.settings(), gameStoreAdmin.feeds()])
      setS(settings)
      setFeeds(list)
    } catch {
      setS(null)
    }
  }, [])
  useEffect(() => void load(), [load])

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await fn()
      toast(done)
      await load()
      return true
    } catch (e) {
      toast((e as Error).message, 'error')
      return false
    } finally {
      setBusy('')
    }
  }

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (await act('add', () => gameStoreAdmin.addFeed(name.trim(), url.trim()), 'Source added')) {
      setName('')
      setUrl('')
    }
  }

  // A server from before the game store has no such page: show nothing.
  if (!s) return null
  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">
        Game store
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] tracking-wider text-ink-400">Beta</span>
      </h3>
      <div className={`${CARD} space-y-4 px-5 py-4`}>
        <Toggle
          checked={s.enabled}
          onChange={(v) =>
            act(
              'toggle',
              async () => {
                await gameStoreAdmin.setEnabled(v)
                // The app learns whether there's a store from the server's features.
                await discover({ force: true })
              },
              v ? 'Game store on' : 'Game store off',
            )
          }
          label="Show the game store"
          description="A store of PC games under Games, for everyone on this server. Finesse comes with no games in it: you choose where they come from below."
        />
        {s.enabled && (
          <div className="space-y-4 border-t border-white/5 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-300">
              <span>
                {s.games ? `${s.games} game${s.games === 1 ? '' : 's'} in the store.` : feeds.length ? 'No games in the store yet.' : 'Add a source to fill the store.'}{' '}
                {s.games > 0 && (
                  <Link to="/games/store" className="text-accent-300 hover:text-white">
                    Open the store
                  </Link>
                )}
              </span>
              {feeds.length > 0 && (
                <button type="button" className={smallBtn} disabled={busy === 'sync'} onClick={() => act('sync', () => gameStoreAdmin.sync(), 'Sources read again')}>
                  {busy === 'sync' && <Spinner className="h-3 w-3" />}
                  Read them again
                </button>
              )}
            </div>
            {!s.canInstall && (
              <p className="rounded-lg bg-white/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-ink-400">
                {s.canDownload
                  ? 'For now a request downloads a game and checks it, then stops: installing arrives with a later update. The download is kept for then.'
                  : 'People can browse the store, but this server can’t download games: that needs a server Finesse set up itself.'}
              </p>
            )}

            {feeds.length > 0 && (
              <ul className="divide-y divide-white/5 rounded-xl border border-white/5">
                {feeds.map((f) => {
                  const sum = feedSummary(f)
                  const notes = f.status?.notes ?? []
                  return (
                    <li key={f.id} className="px-3.5 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium text-white">{f.name}</div>
                          <div className="truncate text-[12px] text-ink-500">{f.url ?? `A file on the server: game-feeds/${f.file}`}</div>
                        </div>
                        <span className={`text-[12.5px] ${sum.bad ? 'text-amber-200' : 'text-ink-300'}`}>{sum.text}</span>
                        {notes.length > 0 && (
                          <button type="button" className={smallBtn} aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? '' : f.id)}>
                            {open === f.id ? 'Hide' : 'Why'}
                          </button>
                        )}
                        {f.url && (
                          <button type="button" className={smallBtn} disabled={busy === `rm-${f.id}`} onClick={() => act(`rm-${f.id}`, () => gameStoreAdmin.removeFeed(f.id), 'Source removed, and its games with it')}>
                            Remove
                          </button>
                        )}
                      </div>
                      {open === f.id && (
                        <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-ink-400">
                          {notes.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            <form onSubmit={add} className="space-y-2">
              <div className="text-[13px] font-medium text-white">Add a source</div>
              <div className="flex flex-wrap gap-2">
                <input className={`${field} w-40`} placeholder="Name" aria-label="Source name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
                <input className={`${field} flex-1 basis-56`} placeholder="https://example.org/games.json" aria-label="Feed address" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" required />
                <button type="submit" className={smallBtn + ' h-9'} disabled={busy === 'add' || !name.trim() || !url.trim()}>
                  {busy === 'add' && <Spinner className="h-3 w-3" />}
                  Add source
                </button>
              </div>
              <p className="text-[12.5px] leading-relaxed text-ink-400">
                A source is a feed: one file that lists games and where each can be downloaded. Give its address here, or put the file in the <span className="text-ink-200">game-feeds</span> folder of Finesse’s config folder on the server and press “Read them again”.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
