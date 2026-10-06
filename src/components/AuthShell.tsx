import type { ReactNode } from 'react'
import { splashscreenUrl } from '../api/client'

/** Cinematic full-screen shell shared by Login + Invite for a seamless brand. */
export default function AuthShell({
  children,
  server = '',
}: {
  children: ReactNode
  server?: string
}) {
  return (
    // Phones: room at the top for the connection badge (a tall page starts right at the top edge).
    <div className="relative min-h-[calc(var(--vh)*100)] flex items-center justify-center overflow-hidden pt-20 pb-10 sm:py-0">
      {server && (
        <img
          src={splashscreenUrl(server)}
          alt=""
          className="slowzoom absolute inset-0 h-full w-full object-cover opacity-40 blur-sm"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/70 via-ink-950/40 to-ink-950" />
      <div className="grain" aria-hidden />
      {children}
    </div>
  )
}

export function FinesseWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={className}>
      Finesse<span className="text-accent-400">.</span>
    </span>
  )
}

export function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex justify-center gap-2 mb-8" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === step
              ? 'w-6 bg-accent-400'
              : i < step
                ? 'w-1.5 bg-accent-400/50'
                : 'w-1.5 bg-white/15'
          }`}
        />
      ))}
    </div>
  )
}

export const authInputClass =
  'mt-1 w-full rounded-lg bg-ink-800/90 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-accent-500 transition-colors'
export const authLabelClass =
  'mt-4 block text-xs font-medium uppercase tracking-wider text-ink-400'
export const authPrimaryBtn =
  'w-full rounded-lg bg-accent-fill hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100 py-2.5 text-sm font-semibold text-white active:scale-[0.98] transition-all'
