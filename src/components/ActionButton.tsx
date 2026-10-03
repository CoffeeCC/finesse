import { forwardRef, type ReactNode } from 'react'

// Detail-page actions: an icon over a visible label ("My List", "Favorite",
// "Trailer", "Play on…", "More") — icon-only circles were guesswork.

/** A detail page's main action (Play, Resume): white, the same everywhere. */
export const PLAY_BTN =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-white text-ink-950 h-11 px-6 text-[15px] font-semibold hover:bg-ink-200 disabled:opacity-60 active:scale-[0.98] transition-all w-full sm:w-auto'

export const ACTION_BTN =
  'group/act flex flex-col items-center gap-1.5 w-16 sm:w-[4.5rem] py-1 rounded-xl text-[12px] font-medium text-ink-200 hover:text-white disabled:opacity-50 transition-colors outline-none'
export const ACTION_CIRCLE =
  'h-11 w-11 rounded-full flex items-center justify-center backdrop-blur-md border transition-all group-active/act:scale-90 group-focus-visible/act:ring-2 group-focus-visible/act:ring-accent-400'
const CIRCLE_IDLE = 'bg-white/10 border-white/15 text-white group-hover/act:bg-white/20'
const CIRCLE_ON = 'bg-accent-500/25 border-accent-400/40 text-accent-300 group-hover/act:bg-accent-500/35'

export const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode
    label: string
    onClick?: () => void
    active?: boolean
    disabled?: boolean
    ariaLabel?: string
    expanded?: boolean
    title?: string
  }
>(function ActionButton({ icon, label, onClick, active, disabled, ariaLabel, expanded, title }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      aria-pressed={active}
      title={title}
      className={ACTION_BTN}
    >
      <span className={`${ACTION_CIRCLE} ${active ? CIRCLE_ON : CIRCLE_IDLE}`}>{icon}</span>
      <span className="leading-tight text-center">{label}</span>
    </button>
  )
})

export const actionCircle = (active = false) => `${ACTION_CIRCLE} ${active ? CIRCLE_ON : CIRCLE_IDLE}`
