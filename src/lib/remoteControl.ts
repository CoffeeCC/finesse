// Makes this Finesse a cast target ("Play on…" from a phone, the Jellyfin apps,
// or another Finesse). Jellyfin only lists a device as controllable when it has
// (1) reported its capabilities and (2) an open websocket to /socket — Finesse
// did neither, so the TV app never showed up as a target at all.
//
// Incoming messages:
//   Play            → open the player (or play music) here
//   Playstate       → pause / seek / stop… forwarded to the player
//   GeneralCommand  → volume, tracks, messages, navigation
//   UserDataChanged / LibraryChanged → refresh cached lists live (a nice
//                     side effect: watch progress now syncs across devices)

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { useAudio } from '../audio/AudioPlayerContext'
import { goBack } from './back'

export type RemoteCommand =
  | { kind: 'playstate'; command: string; seekTicks?: number }
  | { kind: 'general'; name: string; args: Record<string, string | undefined> }

type Listener = (c: RemoteCommand) => boolean | void
const listeners = new Set<Listener>()

/** Subscribe to remote commands (the player does, while it's open). Return true
 *  from the listener when it handled the command. */
export function onRemoteCommand(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function dispatch(c: RemoteCommand): boolean {
  let handled = false
  for (const fn of [...listeners]) if (fn(c)) handled = true
  return handled
}

interface PlayData {
  ItemIds?: string[]
  StartIndex?: number
  StartPositionTicks?: number
  PlayCommand?: string
}

const WATCH_KEYS = ['resume', 'nextUp', 'item', 'episodes', 'seriesNextUp', 'seriesEpisodes', 'lastPlayed', 'watchlistItems']
const LIBRARY_KEYS = ['latest', 'row', 'libIndex', 'itemPage', 'browse', 'views']

/** Mount once (inside the router + providers) while signed in. */
export function useRemoteControl() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const audio = useAudio()
  // The audio context value changes every tick; read it live from a ref.
  const audioRef = useRef(audio)
  audioRef.current = audio

  useEffect(() => {
    if (!session) return
    let ws: WebSocket | null = null
    let closed = false
    let retry = 0
    let retryTimer = 0
    let keepAlive = 0
    let refreshTimer = 0
    const pendingKeys = new Set<string>()

    const send = (MessageType: string, Data?: unknown) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ MessageType, Data }))
    }

    const onPlayer = () =>
      (window.location.pathname + window.location.hash).includes('/play/')

    // Coalesce bursts of change notifications into one refetch. Not while the
    // player is open: nothing on screen needs it, and the player refreshes all
    // watch state when it closes anyway.
    const refresh = (keys: string[]) => {
      keys.forEach((k) => pendingKeys.add(k))
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        if (onPlayer()) {
          pendingKeys.clear()
          return
        }
        for (const k of pendingKeys) queryClient.invalidateQueries({ queryKey: [k] })
        pendingKeys.clear()
      }, 1500)
    }

    const play = async (d: PlayData) => {
      const ids = d.ItemIds ?? []
      const start = Math.max(0, Math.min(ids.length - 1, d.StartIndex ?? 0))
      const id = ids[start]
      if (!id) return
      const ticks = d.StartPositionTicks ?? 0
      let item: Awaited<ReturnType<typeof api.getItem>> | null = null
      try {
        item = await api.getItem(id)
      } catch {
        /* play it anyway — the player reports its own errors */
      }
      // Music: queue everything that was sent, in the audio player.
      if (item?.Type === 'Audio') {
        const res = await api.getItems({ ids: ids.join(','), fields: 'PrimaryImageAspectRatio' }).catch(() => null)
        const byId = new Map((res?.Items ?? []).map((i) => [i.Id, i]))
        const queue = ids.map((i) => byId.get(i)).filter((i): i is NonNullable<typeof i> => !!i)
        if (queue.length) audioRef.current.playQueue(queue, Math.min(start, queue.length - 1))
        return
      }
      // A show was sent: start its next-up episode.
      let target = id
      let at = ticks
      if (item?.Type === 'Series') {
        const next = (await api.getSeriesNextUp(id).catch(() => null))?.Items?.[0]
        if (!next) {
          navigate(`/item/${id}`)
          return
        }
        target = next.Id
        at = !next.UserData?.Played ? next.UserData?.PlaybackPositionTicks ?? 0 : 0
      } else if (item && item.Type !== 'Movie' && item.Type !== 'Episode' && item.Type !== 'Video' && item.Type !== 'MusicVideo') {
        navigate(`/item/${id}`) // a season/collection/etc.: show it rather than guess
        return
      }
      if (audioRef.current.current) audioRef.current.stop() // music off; video takes over
      // Switching titles mid-playback replaces the player entry, so Back still
      // leads out of the player rather than through every cast title.
      navigate(`/play/${target}${at > 0 ? `?t=${at}` : ''}`, { replace: onPlayer() })
    }

    const general = (name: string, args: Record<string, string | undefined>) => {
      if (dispatch({ kind: 'general', name, args })) return
      switch (name) {
        case 'DisplayMessage':
          if (args.Text || args.Header) toast([args.Header, args.Text].filter(Boolean).join(' — '))
          break
        case 'GoHome':
          navigate('/')
          break
        case 'Back':
          goBack(navigate)
          break
        case 'DisplayContent':
          if (args.ItemId) navigate(`/item/${args.ItemId}`)
          break
      }
    }

    const handle = (msg: { MessageType?: string; Data?: unknown }) => {
      switch (msg.MessageType) {
        case 'ForceKeepAlive': {
          // Server wants a KeepAlive at least every Data seconds.
          const every = Math.max(5, Number(msg.Data) || 60) / 2
          window.clearInterval(keepAlive)
          keepAlive = window.setInterval(() => send('KeepAlive'), every * 1000)
          send('KeepAlive')
          break
        }
        case 'Play':
          play((msg.Data ?? {}) as PlayData)
          break
        case 'Playstate': {
          const d = (msg.Data ?? {}) as { Command?: string; SeekPositionTicks?: number }
          if (d.Command) dispatch({ kind: 'playstate', command: d.Command, seekTicks: d.SeekPositionTicks })
          break
        }
        case 'GeneralCommand': {
          const d = (msg.Data ?? {}) as { Name?: string; Arguments?: Record<string, string> }
          if (d.Name) general(d.Name, d.Arguments ?? {})
          break
        }
        case 'UserDataChanged':
          refresh(WATCH_KEYS)
          break
        case 'LibraryChanged':
          refresh([...LIBRARY_KEYS, ...WATCH_KEYS])
          break
      }
    }

    const connect = () => {
      if (closed) return
      const url =
        session.server.replace(/^http/i, 'ws').replace(/\/+$/, '') +
        `/socket?${new URLSearchParams({ ...api.tokenQuery(session.token), deviceId: api.DEVICE_ID })}`
      try {
        ws = new WebSocket(url)
      } catch {
        schedule()
        return
      }
      ws.onopen = () => {
        retry = 0
        // (Re)announce after every connect — a server restart forgets them.
        api.reportCapabilities().catch(() => {})
      }
      ws.onmessage = (ev) => {
        try {
          handle(JSON.parse(String(ev.data)))
        } catch {
          /* not JSON — ignore */
        }
      }
      ws.onclose = () => {
        window.clearInterval(keepAlive)
        schedule()
      }
    }
    const schedule = () => {
      if (closed) return
      window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++))
    }

    api.reportCapabilities().catch(() => {})
    connect()
    return () => {
      closed = true
      window.clearTimeout(retryTimer)
      window.clearTimeout(refreshTimer)
      window.clearInterval(keepAlive)
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    }
    // toast/navigate/queryClient are stable for the app's lifetime; audio via ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.server, session?.token])
}
