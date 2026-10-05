import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { groupsApi, type GroupsOverview } from '../../api/setup'
import { useToast } from '../../components/Toast'
import { Spinner } from '../setup/ui'

const CARD = 'rounded-2xl bg-ink-900/60 border border-white/5'
const smallBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-ink-200 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'
const primaryBtn = 'inline-flex h-9 items-center gap-2 rounded-lg bg-accent-fill px-4 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 transition'
const input = 'h-10 w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 text-sm text-white placeholder:text-ink-500 outline-none focus:border-accent-500'
const label = 'block text-[11px] font-semibold uppercase tracking-wider text-ink-400'

const ago = (iso: string | null) => {
  if (!iso) return 'not yet'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

function LibraryPicker({ libraries, picked, onChange }: { libraries: GroupsOverview['libraries']; picked: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {libraries.map((l) => {
        const on = picked.includes(l.id)
        return (
          <label key={l.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${on ? 'border-accent-400/60 bg-accent-500/15 text-white' : 'border-white/10 text-ink-300 hover:border-white/25'}`}>
            <input type="checkbox" className="h-3.5 w-3.5" checked={on} onChange={(e) => onChange(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
            {l.name}
          </label>
        )
      })}
    </div>
  )
}

/** Settings → Server → Groups: share libraries with friends who run Finesse too, and watch theirs. */
export default function GroupsAdmin() {
  const toast = useToast()
  const qc = useQueryClient()
  const [o, setO] = useState<GroupsOverview | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [sharePick, setSharePick] = useState<string[]>([])
  const [code, setCode] = useState<{ code: string; expires: string } | null>(null)
  const [addUrl, setAddUrl] = useState('')
  const [addCode, setAddCode] = useState('')
  const [addErr, setAddErr] = useState('')
  const [backFor, setBackFor] = useState<string | null>(null)
  const [backPick, setBackPick] = useState<string[]>([])
  const [armed, setArmed] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setO(await groupsApi.overview())
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [])
  useEffect(() => void load(), [load])
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(null), 4000)
    return () => clearTimeout(t)
  }, [armed])

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    try {
      await fn()
      if (done) toast(done)
      await load()
      void qc.invalidateQueries({ queryKey: ['friends'] })
      return true
    } catch (e) {
      toast((e as Error).message, 'error')
      return false
    } finally {
      setBusy(null)
    }
  }

  if (!o) return <div className={`${CARD} p-5`}>{err ? <p className="text-sm text-red-300">{err}</p> : <div className="h-24 rounded-xl shimmer" />}</div>
  const libName = (id: string) => o.libraries.find((l) => l.id === id)?.name ?? 'a removed library'

  return (
    <div id="settings-groups" className="space-y-3 scroll-mt-24">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Groups</p>
      <div className={`${CARD} space-y-6 px-5 py-5`}>
        <p className="text-[13px] leading-relaxed text-ink-300">
          Share libraries with friends who run Finesse too, and watch theirs. They watch through their own Finesse: nobody gets an account here, and nothing can be requested or downloaded.
        </p>

        {o.offers.map((offer) => (
          <div key={offer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-400/30 bg-accent-500/10 px-4 py-3">
            <p className="text-[13px] text-white">
              <span className="font-semibold">{offer.name}</span> wants to share with you.
            </p>
            <div className="flex gap-2">
              <button type="button" className={primaryBtn} disabled={busy === offer.id} onClick={() => void run(offer.id, () => groupsApi.acceptOffer(offer.id), `Added ${offer.name}`)}>
                {busy === offer.id && <Spinner className="h-3 w-3" />}
                Add it
              </button>
              <button type="button" className={smallBtn} onClick={() => void run(`x${offer.id}`, () => groupsApi.dismissOffer(offer.id))}>
                Not now
              </button>
            </div>
          </div>
        ))}

        {/* Share ours */}
        <div className="space-y-3">
          <p className="text-[13px] font-semibold text-white">Share with a friend’s server</p>
          <p className="text-[12.5px] text-ink-400">Pick what they can watch. You can change it later.</p>
          <LibraryPicker libraries={o.libraries} picked={sharePick} onChange={setSharePick} />
          <button
            type="button"
            className={primaryBtn}
            disabled={!sharePick.length || busy === 'code'}
            onClick={() =>
              void run('code', async () => {
                setCode(await groupsApi.createCode(sharePick))
              })
            }
          >
            {busy === 'code' && <Spinner className="h-3 w-3" />}
            Create a code
          </button>
          {code && (
            <div className="rounded-xl border border-white/10 bg-ink-950/50 px-4 py-3">
              <p className="font-mono text-2xl tracking-[0.15em] text-white select-all">{code.code}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-300">
                Send your friend this code {o.publicUrl ? (
                  <>
                    and your address, <span className="select-all text-white">{o.publicUrl}</span>.
                  </>
                ) : (
                  'and your server’s address.'
                )}{' '}
                It works once, within 7 days.
              </p>
              {!o.publicUrl && (
                <p className="mt-2 text-[12.5px] text-amber-200">
                  Their server has to reach yours over the internet.{' '}
                  <Link to="/setup?change=1" className="font-semibold underline underline-offset-2 hover:text-white">Set up away-from-home access</Link> (free with Tailscale), or enter your own address under Invites &amp; sharing.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Add theirs */}
        <form
          className="space-y-3 border-t border-white/5 pt-5"
          onSubmit={(e) => {
            e.preventDefault()
            setAddErr('')
            void (async () => {
              setBusy('add')
              try {
                const f = await groupsApi.addFriend(addUrl, addCode)
                toast(`Added ${f.name}. It’s under Friends.`)
                setAddUrl('')
                setAddCode('')
                await load()
                void qc.invalidateQueries({ queryKey: ['friends'] })
              } catch (er) {
                setAddErr((er as Error).message)
              } finally {
                setBusy(null)
              }
            })()
          }}
        >
          <p className="text-[13px] font-semibold text-white">Add a friend’s server</p>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div>
              <label className={label} htmlFor="group-url">
                Their address
              </label>
              <input id="group-url" className={`${input} mt-1`} value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="https://their-server.example.com" autoComplete="off" />
            </div>
            <div>
              <label className={label} htmlFor="group-code">
                Their code
              </label>
              <input id="group-code" className={`${input} mt-1 font-mono uppercase`} value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="ABCD-EFGH-JKLM" autoComplete="off" />
            </div>
          </div>
          {addErr && <p className="text-[12.5px] text-red-300">{addErr}</p>}
          <button type="submit" className={primaryBtn} disabled={!addUrl.trim() || !addCode.trim() || busy === 'add'}>
            {busy === 'add' && <Spinner className="h-3 w-3" />}
            Add
          </button>
        </form>

        {o.links.length > 0 && (
          <div className="space-y-2 border-t border-white/5 pt-5">
            <p className="text-[13px] font-semibold text-white">Watching your server</p>
            <ul className="divide-y divide-white/5">
              {o.links.map((l) => (
                <li key={l.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-white">{l.name}</p>
                      <p className="text-[12px] text-ink-400">
                        Last here {ago(l.lastSeen)}
                        {l.viewers.length ? ` · ${l.viewers.length} ${l.viewers.length === 1 ? 'person' : 'people'} watched` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`${smallBtn} ${armed === l.id ? 'border-red-400/60 text-red-200' : ''}`}
                      disabled={busy === `rm${l.id}`}
                      onClick={() => (armed === l.id ? void run(`rm${l.id}`, () => groupsApi.removeLink(l.id), `Stopped sharing with ${l.name}`) : setArmed(l.id))}
                    >
                      {armed === l.id ? 'Tap again to stop sharing' : 'Stop sharing'}
                    </button>
                  </div>
                  <LibraryPicker libraries={o.libraries} picked={l.libraries} onChange={(ids) => void run(`lib${l.id}`, () => groupsApi.setLinkLibraries(l.id, ids), ids.length ? `Now sharing ${ids.map(libName).join(', ')}` : 'Sharing nothing for now')} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {o.friends.length > 0 && (
          <div className="space-y-2 border-t border-white/5 pt-5">
            <p className="text-[13px] font-semibold text-white">Servers you watch</p>
            <ul className="divide-y divide-white/5">
              {o.friends.map((f) => (
                <li key={f.id} className="space-y-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-white">{f.name}</p>
                      <p className="truncate text-[12px] text-ink-400">{f.url}</p>
                    </div>
                    <div className="flex gap-2">
                      {!o.links.some((l) => l.name === f.name) && (
                        <button type="button" className={smallBtn} onClick={() => setBackFor(backFor === f.id ? null : f.id)}>
                          Share yours back
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${smallBtn} ${armed === f.id ? 'border-red-400/60 text-red-200' : ''}`}
                        disabled={busy === `rf${f.id}`}
                        onClick={() => (armed === f.id ? void run(`rf${f.id}`, () => groupsApi.removeFriend(f.id), `Removed ${f.name}`) : setArmed(f.id))}
                      >
                        {armed === f.id ? 'Tap again to remove' : 'Remove'}
                      </button>
                    </div>
                  </div>
                  {backFor === f.id && (
                    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <p className="text-[12.5px] text-ink-300">What should {f.name} be able to watch? They add you with one click.</p>
                      <LibraryPicker libraries={o.libraries} picked={backPick} onChange={setBackPick} />
                      <button
                        type="button"
                        className={primaryBtn}
                        disabled={!backPick.length || busy === `back${f.id}`}
                        onClick={() =>
                          void run(`back${f.id}`, () => groupsApi.offer(f.id, backPick), `Sent. ${f.name} can add you now.`).then((ok) => ok && setBackFor(null))
                        }
                      >
                        {busy === `back${f.id}` && <Spinner className="h-3 w-3" />}
                        Send
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
