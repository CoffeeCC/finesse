import { useEffect, useRef, useState } from 'react'
import { LOFI_STILL, LOFI_VIDEOS, loadLofi, lofiUserGesture, setLofiMuted, useLofi } from './lofi'

/** Starts loading the song once the wizard is up, and starts it on the first click. */
export function useLofiWizard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    // Lazily: after the page has settled, so it never competes with the wizard.
    const t = window.setTimeout(loadLofi, 1500)
    const onClick = () => lofiUserGesture()
    document.addEventListener('pointerdown', onClick, true)
    document.addEventListener('keydown', onClick, true)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('pointerdown', onClick, true)
      document.removeEventListener('keydown', onClick, true)
    }
  }, [enabled])
}

/** The corner toggle, on every step. Hidden until the music can play (and for good if it can't). */
export function LoFinessaToggle() {
  const { status, muted, playing } = useLofi()
  if (status !== 'ready') return null
  const on = !muted
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setLofiMuted(on)
      }}
      aria-pressed={on}
      title="Lo-Finessa: original lo-fi music, made for Finesse"
      className="fixed bottom-4 right-4 z-40 inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-ink-900/80 px-3.5 text-[12.5px] font-medium text-ink-200 backdrop-blur transition-colors hover:border-white/25 hover:text-white"
    >
      <span aria-hidden className={on && playing ? 'text-accent-300' : 'text-ink-400'}>
        ♪
      </span>
      Lo-Finessa: {on ? 'on' : 'off'}
    </button>
  )
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** "Building your server": Nessa at her desk, rain outside, as a soft card. A still frame with reduced motion. */
export function LoFinessaCard() {
  const { status, muted, playing } = useLofi()
  // Shown once a frame has loaded; gone for good if the video can't load.
  const [shown, setShown] = useState<'wait' | 'ok' | 'no'>('wait')
  const setOk = (v: boolean) => setShown(v ? 'ok' : 'no')
  const video = useRef<HTMLVideoElement>(null)
  const still = reducedMotion()
  useEffect(() => {
    const v = video.current
    if (!v || still) return
    void v.play().catch(() => {})
  }, [still])
  if (shown === 'no') return null
  const caption = status === 'ready' && (
    <figcaption className="absolute bottom-3 left-4 text-[12px] font-medium text-white/85">
      {playing && !muted ? '♪ Now playing: Lo-Finessa' : 'Lo-Finessa'}
      <span className="text-white/50"> · original music, made for Finesse</span>
    </figcaption>
  )
  // Reduced motion: the still frame, no video at all.
  if (still) {
    return (
      <figure className={`relative mt-8 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/60 ${shown === 'wait' ? 'hidden' : ''}`}>
        <img src={LOFI_STILL} alt="" className="aspect-video w-full object-cover opacity-80" onLoad={() => setOk(true)} onError={() => setOk(false)} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-transparent" />
        {caption}
      </figure>
    )
  }
  return (
    <figure className={`relative mt-8 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/60 ${shown === 'wait' ? 'hidden' : ''}`}>
      <video
        ref={video}
        className="aspect-video w-full object-cover opacity-80"
        muted
        playsInline
        poster={LOFI_STILL}
        loop
        autoPlay
        preload="auto"
        aria-hidden
        onLoadedData={() => setOk(true)}
        onError={() => setOk(false)}
      >
        {LOFI_VIDEOS.map((src) => (
          <source key={src} src={src} type={src.endsWith('.webm') ? 'video/webm' : 'video/mp4'} onError={(e) => {
            // The last source failing means there's nothing to show.
            if (e.currentTarget === e.currentTarget.parentElement?.lastElementChild) setOk(false)
          }} />
        ))}
      </video>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-transparent" />
      {caption}
    </figure>
  )
}
