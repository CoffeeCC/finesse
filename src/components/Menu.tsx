import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { pushBackHandler } from '../lib/back'

// The app's own dropdowns: native <select> looks like the OS (and can't be
// styled or reached cleanly with a remote), so sort pickers, filters and ⋯
// menus all share this. Closes on outside click and Escape / remote Back (the
// shared back-handler stack), focuses the chosen option when it opens, and
// hands focus back to its button when it closes — D-pad friendly throughout.

function usePopover() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    const pop = pushBackHandler(() => {
      close()
      return true
    })
    // Land on the selected option (else the first) so OK/Enter picks right away.
    // (Next frame: the portalled panel mounts after this effect's commit.)
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      const target =
        panel?.querySelector<HTMLElement>('[aria-checked="true"], [aria-selected="true"]') ??
        panel?.querySelector<HTMLElement>('button:not([disabled])')
      target?.focus({ preventScroll: true })
    })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      cancelAnimationFrame(raf)
      pop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return { open, setOpen, close, wrapRef, triggerRef, panelRef }
}

/** The open menu, portalled to <body> and pinned to its button with fixed
 *  positioning — so a scrolling toolbar or a clipped row can't cut it off or
 *  paint over it. Flips above the button when there's no room below. */
function Panel({
  pop,
  align,
  placement = 'below',
  className = '',
  children,
  ...aria
}: {
  pop: ReturnType<typeof usePopover>
  align: 'left' | 'right'
  placement?: 'below' | 'above'
  className?: string
  children: ReactNode
  id: string
  role: string
  'aria-label': string
}) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    const place = () => {
      const t = pop.triggerRef.current?.getBoundingClientRect()
      const panel = pop.panelRef.current
      if (!t || !panel) return
      const h = panel.offsetHeight
      const vh = window.innerHeight
      const up = placement === 'above' || (t.bottom + 8 + h > vh - 8 && t.top - 8 - h > 8)
      const next: CSSProperties = { position: 'fixed', top: up ? t.top - 8 - h : t.bottom + 8 }
      if (align === 'right') next.right = Math.max(8, window.innerWidth - t.right)
      else next.left = Math.max(8, t.left)
      setStyle(next)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [pop, align, placement])
  return createPortal(
    <div ref={pop.panelRef} style={style} className={`${PANEL} ${className}`} {...aria}>
      {children}
    </div>,
    document.body,
  )
}

const PANEL =
  'z-[95] min-w-[12rem] max-h-[calc(var(--vh)*60)] overflow-y-auto rounded-xl bg-ink-800 border border-white/10 shadow-2xl shadow-black/50 p-1.5 toast-in'
const ITEM =
  'w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:bg-white/10 hover:bg-white/5'
const Check = () => (
  <svg className="h-4 w-4 shrink-0 text-accent-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
)
const Chevron = ({ open }: { open: boolean }) => (
  <svg className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
)

export const MENU_TRIGGER =
  'inline-flex items-center gap-2 h-9 rounded-full bg-ink-800/80 border border-white/10 pl-3.5 pr-2.5 text-sm text-ink-200 hover:text-white hover:border-white/20 transition-colors'

export interface MenuOption<T> {
  value: T
  label: string
}

/** Pick one: "Sort: Recently added ▾". */
export function SelectMenu<T extends string | number>({
  label,
  value,
  options,
  onChange,
  prefix,
  align = 'left',
  triggerClassName = MENU_TRIGGER,
}: {
  /** Accessible name of the control, e.g. "Sort by". */
  label: string
  value: T
  options: MenuOption<T>[]
  onChange: (v: T) => void
  /** Shown before the current value on the button, e.g. "Sort:". */
  prefix?: string
  align?: 'left' | 'right'
  triggerClassName?: string
}) {
  const pop = usePopover()
  const id = useId()
  const current = options.find((o) => o.value === value)
  return (
    <div ref={pop.wrapRef} className="relative shrink-0">
      <button
        ref={pop.triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        aria-controls={id}
        aria-label={`${label}: ${current?.label ?? ''}`}
        onClick={() => pop.setOpen((o) => !o)}
        className={triggerClassName}
      >
        <span className="truncate">
          {prefix && <span className="text-ink-400">{prefix} </span>}
          {current?.label}
        </span>
        <Chevron open={pop.open} />
      </button>
      {pop.open && (
        <Panel pop={pop} align={align} id={id} role="menu" aria-label={label}>
          {options.map((o) => {
            const on = o.value === value
            return (
              <button
                key={String(o.value)}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  onChange(o.value)
                  pop.close()
                }}
                className={`${ITEM} ${on ? 'text-white font-semibold' : 'text-ink-200'}`}
              >
                {o.label}
                {on && <Check />}
              </button>
            )
          })}
        </Panel>
      )}
    </div>
  )
}

/** Pick several: "Genre: Action, Comedy ▾" with a Clear. */
export function MultiSelectMenu({
  label,
  values,
  options,
  onChange,
  align = 'left',
}: {
  label: string
  values: Set<string>
  options: string[]
  onChange: (next: Set<string>) => void
  align?: 'left' | 'right'
}) {
  const pop = usePopover()
  const id = useId()
  const picked = options.filter((o) => values.has(o))
  const summary = picked.length === 0 ? 'Any' : picked.length <= 2 ? picked.join(', ') : `${picked.length} picked`
  const active = picked.length > 0
  const toggle = (o: string) => {
    const next = new Set(values)
    if (next.has(o)) next.delete(o)
    else next.add(o)
    onChange(next)
  }
  return (
    <div ref={pop.wrapRef} className="relative shrink-0">
      <button
        ref={pop.triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        aria-controls={id}
        onClick={() => pop.setOpen((o) => !o)}
        className={
          active
            ? 'inline-flex items-center gap-2 h-9 rounded-full bg-accent-500/15 border border-accent-400/50 pl-3.5 pr-2.5 text-sm text-accent-300 hover:text-white transition-colors'
            : MENU_TRIGGER
        }
      >
        <span className="truncate max-w-[14rem]">
          <span className={active ? '' : 'text-ink-400'}>{label}: </span>
          {summary}
        </span>
        <Chevron open={pop.open} />
      </button>
      {pop.open && (
        <Panel pop={pop} align={align} id={id} role="menu" aria-label={label} className="w-60">
          {options.map((o) => {
            const on = values.has(o)
            return (
              <button
                key={o}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => toggle(o)}
                className={`${ITEM} ${on ? 'text-white font-semibold' : 'text-ink-200'}`}
              >
                {o}
                {on && <Check />}
              </button>
            )
          })}
          {active && (
            <>
              <div className="h-px my-1.5 mx-1 bg-white/10" />
              <button type="button" onClick={() => onChange(new Set())} className={`${ITEM} text-accent-300 font-semibold`}>
                Clear
              </button>
            </>
          )}
        </Panel>
      )}
    </div>
  )
}

export interface ActionItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Starts a new labelled group ("Admin"). */
  section?: string
}

/** A ⋯ (or labelled) button that opens a list of actions. */
export function ActionMenu({
  label,
  items,
  align = 'right',
  children,
  triggerClassName,
  placement = 'below',
}: {
  label: string
  items: ActionItem[]
  align?: 'left' | 'right'
  /** Button content; defaults to a ⋯ icon. */
  children?: ReactNode
  triggerClassName?: string
  placement?: 'below' | 'above'
}) {
  const pop = usePopover()
  const id = useId()
  if (items.length === 0) return null
  return (
    <div ref={pop.wrapRef} className="relative shrink-0">
      <button
        ref={pop.triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        aria-controls={id}
        aria-label={children ? undefined : label}
        onClick={() => pop.setOpen((o) => !o)}
        className={
          triggerClassName ??
          'h-9 w-9 rounded-full flex items-center justify-center text-ink-400 hover:text-white hover:bg-white/10 transition-colors'
        }
      >
        {children ?? (
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        )}
      </button>
      {pop.open && (
        <Panel pop={pop} align={align} placement={placement} id={id} role="menu" aria-label={label} className="w-56">
          {items.map((it, i) => (
            <div key={`${it.label}-${i}`}>
              {it.section && (
                <>
                  {i > 0 && <div className="h-px my-1.5 mx-1 bg-white/10" />}
                  <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{it.section}</p>
                </>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  pop.close()
                  it.onSelect()
                }}
                className={`${ITEM} text-ink-200 disabled:opacity-40`}
              >
                {it.label}
              </button>
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}
