// Settings → Server → Preview clips (administrators): on or off, how many titles
// have one, and why none are being made when they can't be (server/src/stack/clips.ts).
// On every install: servers Finesse set up, and ones using someone's own Jellyfin.

import { useCallback, useEffect, useState } from 'react'
import { systemApi, type PreviewStatus } from '../../api/setup'
import { useToast } from '../../components/Toast'
import { Spinner, Toggle } from '../setup/ui'

const CARD = 'rounded-2xl bg-ink-900/60 border border-white/5'
const smallBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-ink-200 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'

/** One line: how far along the clips are. */
export function previewSummary(p: PreviewStatus): string {
  if (!p.enabled) return 'Off'
  if (!p.total) return p.lastRun ? 'No titles with a video file yet.' : 'Finesse hasn’t looked at the library yet. It does within a few minutes.'
  if (p.made >= p.total) return `All ${p.total} titles have clips.`
  return `${p.made} of ${p.total} titles have clips${p.state === 'making' ? ', and the rest are on the way.' : '.'}`
}

export default function PreviewClips() {
  const toast = useToast()
  const [p, setP] = useState<PreviewStatus | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setP(await systemApi.previews())
    } catch {
      setP(null)
    }
  }, [])
  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 30000)
    return () => clearInterval(t)
  }, [load])

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await fn()
      toast(done)
      await load()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  if (!p) return null
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Preview clips</h3>
      <div className={`${CARD} space-y-3 px-5 py-4`}>
        <Toggle
          checked={p.enabled}
          onChange={(v) => act('toggle', () => systemApi.setPreviews(v), v ? 'Preview clips on' : 'Preview clips off')}
          label="Make preview clips"
          description="Short clips play when you hover a poster or open a title, and episodes get a “next time on…” teaser. Made quietly in the background at low priority."
        />
        {p.enabled && (
          <div className="space-y-2 border-t border-white/5 pt-3 text-[13px] text-ink-300">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{previewSummary(p)}</span>
              {p.state !== 'blocked' && p.pending > 0 && (
                <button type="button" className={smallBtn} disabled={busy === 'make'} onClick={() => act('make', () => systemApi.makePreviews(), 'Making clips in the background')}>
                  {busy === 'make' && <Spinner className="h-3 w-3" />}
                  Make them now
                </button>
              )}
            </div>
            {p.reason && <p className={`text-[12.5px] leading-relaxed ${p.state === 'blocked' ? 'text-amber-200' : 'text-ink-400'}`}>{p.reason}</p>}
            {p.removed > 0 && <p className="text-[12.5px] text-ink-400">Removed {p.removed} old clip{p.removed > 1 ? 's' : ''} of titles Jellyfin no longer has.</p>}
            {p.failed > 0 && <p className="text-[12.5px] text-ink-400">{p.failed} title{p.failed > 1 ? 's' : ''} couldn’t be made into a clip; Finesse tries again after it restarts.</p>}
            {p.where && p.state === 'making' && <p className="text-[12px] text-ink-500">Made {p.where}.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
