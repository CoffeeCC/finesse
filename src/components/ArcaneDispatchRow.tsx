import type { ArrQueueItem } from '../api/arr'
import { useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react'
import ArrThumb from './ArrThumb'
import { arcaneTrinkets } from '../lib/arcaneTrinkets'
import { playArcaneSound } from '../lib/sound'

/** Physical presentation of the existing queue actions; the owning row keeps their behavior. */
export default function ArcaneDispatchRow({ d, busy, armed, onRetry, onPause, onCancel, via }: {
  d: ArrQueueItem; busy: boolean; armed: boolean; onRetry: () => Promise<void>; onPause: () => Promise<void>; onCancel: () => Promise<void>;
  via?: { label: string; hint: string }
}) {
  const attention = d.status === 'Needs attention', progress = Number.isFinite(d.progress) ? Math.max(0, Math.min(100, d.done ? 100 : d.progress)) : 0
  const root=useRef<HTMLElement>(null), lastAction=useRef<'retry'|'pause'|'cancel'|null>(null)
  const act=(kind:NonNullable<typeof lastAction.current>,event:MouseEvent<HTMLButtonElement>,run:()=>Promise<void>)=>{lastAction.current=kind;event.currentTarget.focus({preventScroll:true});void run()}
  useLayoutEffect(()=>{
    const node=root.current,active=document.activeElement
    if(!node||!lastAction.current)return
    if(busy&&(active===document.body||node.contains(active))){node.focus({preventScroll:true});return}
    if(!busy&&(active===node||active===document.body)){
      const target=node.querySelector<HTMLElement>(`[data-dispatch-action="${lastAction.current}"]:not([disabled])`)??node.querySelector<HTMLElement>('button:not([disabled])')
      target?.focus({preventScroll:true})
    }
  },[busy,d.paused,d.status])
  useEffect(()=>{
    const node=root.current,dialog=node?.closest('[role="dialog"]')
    const outside=(event:Event)=>{if(event.target instanceof Node&&event.target!==document.body&&!node?.contains(event.target))lastAction.current=null}
    document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside)
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside);if(lastAction.current)requestAnimationFrame(()=>{if(document.activeElement===document.body&&dialog?.isConnected)dialog.querySelector<HTMLElement>('button')?.focus({preventScroll:true})})}
  },[])
  return <article ref={root} tabIndex={-1} className="arcane-dispatch-entry" data-arcane-download-key={d.key} aria-label={d.title} aria-busy={busy}>
    <div className="dispatch-record"><span className="dispatch-title-card"><ArrThumb kind={d.kind} id={d.refId} remote={d.poster} title={d.title} /></span><div><h3>{d.title}</h3>{d.detail && <p>{d.detail}</p>}<p className="dispatch-progress-status">{d.status}{!d.done && !attention ? ` · ${progress}%` : ''}</p>{via && <p title={via.hint}>{via.label}</p>}</div></div>
    <progress aria-label={`Download progress for ${d.title}`} value={progress} max={100} />
    {attention && <p className="dispatch-reason">{d.reason || 'This download couldn’t be imported. Retry to find a different release.'}</p>}
    {!d.done && <div className="dispatch-action-objects">
      {attention && d.queueIds.length > 0 && <button type="button" className="dispatch-action" data-dispatch-action="retry" data-ui-sound="handled" aria-label={`Retry ${d.title} — find another release`} disabled={busy} onClick={(e) => { playArcaneSound('courier-horn');act('retry',e,onRetry) }}><span className="dispatch-retry-art" data-dispatch-model="retry"><img src={arcaneTrinkets.dispatchRetry} alt="" /></span><span>Find another release</span></button>}
      {d.nzoIds.length > 0 && <button type="button" className="dispatch-action" data-dispatch-action="pause" data-ui-sound="handled" data-paused={d.paused ? 'true' : 'false'} aria-label={`${d.paused ? 'Resume' : 'Pause'} ${d.title}`} disabled={busy} onClick={(e) => { playArcaneSound('escapement');act('pause',e,onPause) }}><span className="dispatch-pause-art" data-dispatch-model="pause"><img src={arcaneTrinkets.dispatchPause} alt="" /></span><span>{d.paused ? 'Resume' : 'Pause'}</span></button>}
      {d.queueIds.length > 0 && <button type="button" className="dispatch-action" data-dispatch-action="cancel" data-ui-sound="handled" data-confirm-armed={armed ? 'true' : 'false'} aria-label={`${armed ? 'Confirm cancellation of' : 'Cancel'} ${d.title}`} disabled={busy} onClick={(e) => { playArcaneSound(armed ? 'shears-cut' : 'shears-open');act('cancel',e,onCancel) }}><span className="dispatch-cancel-art" data-dispatch-model="cancel"><img src={arcaneTrinkets.dispatchCancel} alt="" /></span><span>{armed ? 'Confirm cancellation' : 'Cancel download'}</span></button>}
    </div>}
    {armed && <p className="dispatch-confirmation" role="status">Tap the shears again to cancel this download.</p>}
    {busy && <p className="dispatch-working" role="status">Updating this dispatch…</p>}
  </article>
}
