// The player's side of a watch party: join, report in every second, and follow the party's
// clock (lib/partySync steer). Play, pause and seeks made here go to the party; the ones the
// party makes here are not sent back. Leaving the player (or switching title) leaves the party.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { beatParty, controlParty, joinParty, leaveParty, type PartyView } from '../api/parties'
import { clockOffset, JUMP, positionAt, steer } from './partySync'

export interface PartyState {
  view: PartyView | null
  /** Couldn't join (not invited, can't open the title, party over): playing alone. */
  error: string | null
  /** The party ended or the server stopped answering; playing alone now. */
  lost: string | null
}

export function usePartySync(
  partyId: string | null,
  itemId: string | undefined,
  o: { videoRef: RefObject<HTMLVideoElement | null>; position: () => number; seekTo: (sec: number) => void; buffering: boolean },
): PartyState & { leave: () => void } {
  const [state, setState] = useState<PartyState>({ view: null, error: null, lost: null })
  const live = useRef(o)
  live.current = o
  const offset = useRef(0)
  const quietUntil = useRef(0)
  const viewRef = useRef<PartyView | null>(null)
  const done = useRef(false)

  useEffect(() => {
    if (!partyId || !itemId) return
    done.current = false
    let stopped = false
    let fails = 0
    const t0 = Date.now()
    const take = (v: PartyView, sent: number) => {
      offset.current = clockOffset(sent, Date.now(), v.serverNow)
      viewRef.current = v
      setState((s) => ({ ...s, view: v }))
    }
    const follow = () => {
      const v = viewRef.current
      const video = live.current.videoRef.current
      if (!v || !video) return
      const now = Date.now() + offset.current
      const s = steer({ position: live.current.position(), playing: !video.paused }, v.clock, now)
      if (s.seek !== null || s.play !== null) quietUntil.current = Date.now() + 1500
      if (s.seek !== null) live.current.seekTo(s.seek)
      if (s.play === true) video.play().catch(() => {})
      if (s.play === false) video.pause()
      video.playbackRate = s.rate
    }
    joinParty(partyId).then(
      (v) => {
        if (stopped) return
        if (v.item !== itemId) {
          setState({ view: null, error: 'That party is watching something else.', lost: null })
          return
        }
        take(v, t0)
        follow()
      },
      (e: Error) => !stopped && setState({ view: null, error: e.message, lost: null }),
    )
    const timer = window.setInterval(async () => {
      if (!viewRef.current || done.current) return
      const sent = Date.now()
      try {
        const v = await beatParty(partyId, live.current.position(), live.current.buffering)
        if (stopped) return
        fails = 0
        take(v, sent)
        follow()
      } catch (e) {
        if (++fails >= 5 || /over|not invited|join/i.test((e as Error).message)) {
          done.current = true
          viewRef.current = null
          if (live.current.videoRef.current) live.current.videoRef.current.playbackRate = 1
          setState((s) => ({ ...s, view: null, lost: /over|not invited/i.test((e as Error).message) ? 'The watch party is over. Carrying on here on your own.' : 'Lost touch with the watch party. Carrying on here on your own.' }))
        }
      }
    }, 1000)

    // What's done here goes to everyone (not what the party itself just did here).
    const video = o.videoRef.current
    const send = (action: 'play' | 'pause' | 'seek', position?: number) => {
      if (!viewRef.current || done.current || Date.now() < quietUntil.current) return
      controlParty(partyId, action, position).then((v) => take(v, Date.now()), () => {})
    }
    const onPlay = () => send('play')
    const onPause = () => {
      if (!live.current.buffering) send('pause')
    }
    const onSeeked = () => {
      const v = viewRef.current
      if (!v) return
      const here = live.current.position()
      if (Math.abs(here - positionAt(v.clock, Date.now() + offset.current)) > JUMP) send('seek', here)
    }
    video?.addEventListener('play', onPlay)
    video?.addEventListener('pause', onPause)
    video?.addEventListener('seeked', onSeeked)
    return () => {
      stopped = true
      window.clearInterval(timer)
      video?.removeEventListener('play', onPlay)
      video?.removeEventListener('pause', onPause)
      video?.removeEventListener('seeked', onSeeked)
      if (video) video.playbackRate = 1
      if (!done.current) void leaveParty(partyId)
    }
    // The video element is the player's one <video>; it's there for the player's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, itemId])

  return {
    ...state,
    leave: () => {
      if (!partyId || done.current) return
      done.current = true
      viewRef.current = null
      if (live.current.videoRef.current) live.current.videoRef.current.playbackRate = 1
      void leaveParty(partyId)
      setState({ view: null, error: null, lost: 'You left the watch party. Carrying on here on your own.' })
    },
  }
}
