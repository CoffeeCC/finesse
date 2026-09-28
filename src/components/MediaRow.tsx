import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import MediaCard, { WideCard } from './MediaCard'
import { CardSkeleton, WideSkeleton } from './Skeletons'
import { ActionMenu } from './Menu'
import { IS_TV } from '../lib/device'
import type { JfItem } from '../api/types'

/** Home rows get a ⋯ menu (hide / move / customise) from their frame. */
export interface RowControls {
  onHide: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onCustomize: () => void
}
export const RowControlsContext = createContext<RowControls | null>(null)

interface Props {
  title: ReactNode
  items: JfItem[] | undefined
  loading?: boolean
  seeAllHref?: string
  /** Hide the row's own title bar (used when an outer frame already shows it). */
  hideTitle?: boolean
  /** Show a hover “×” on cards that calls this (e.g. drop from Up next). */
  onDismissItem?: (item: JfItem) => void
  /** Which cards get the ×; all of them when omitted. */
  canDismiss?: (item: JfItem) => boolean
  /** 'wide' = landscape play-now tiles; 'ranked' = Top 10, rank set in each poster. */
  variant?: 'poster' | 'wide' | 'ranked'
  /** Rows with fewer titles than this fold away instead of showing a sparse shelf. */
  minItems?: number
  /** Extra controls beside the title (e.g. a Movies / Shows switch). */
  headerExtra?: ReactNode
}

// Posters: a touch narrower on phones so ~2.5 cards show (the peek says "scroll me").
const CARD_W = typeof window !== 'undefined' && window.innerWidth < 640 ? 144 : 176
/** Top 10 posters run a little narrower to make room for the numerals. */

const ARROW = 'h-8 w-8 rounded-full bg-ink-800 hover:bg-ink-700 flex items-center justify-center text-ink-200 transition-colors'

/** Title bar shared by every home row: title (optionally a See-all link),
 *  extra controls, the ⋯ customise menu, and desktop scroll arrows. */
export function RowHeader({
  title,
  seeAllHref,
  extra,
  onScroll,
}: {
  title: ReactNode
  seeAllHref?: string
  extra?: ReactNode
  onScroll?: (dir: number) => void
}) {
  const controls = useContext(RowControlsContext)
  return (
    <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-12 mb-3">
      {seeAllHref ? (
        <h2 className="min-w-0">
          <Link
            to={seeAllHref}
            className="group/title row-title flex items-baseline gap-2 min-w-0 text-white hover:text-accent-300 transition-colors"
          >
            <span className="truncate">{title}</span>
            <span className="shrink-0 font-sans not-italic text-xs font-semibold text-accent-300 opacity-0 group-hover/row:opacity-100 group-focus-visible/title:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
              See all
            </span>
          </Link>
        </h2>
      ) : (
        <h2 className="row-title text-white min-w-0 truncate">{title}</h2>
      )}
      {extra}
      <div className="flex-1" />
      {controls && !IS_TV && (
        <div className="opacity-100 md:opacity-0 md:group-hover/row:opacity-100 md:focus-within:opacity-100 transition-opacity">
          <ActionMenu
            label="Row options"
            items={[
              { label: 'Hide this row', onSelect: controls.onHide },
              ...(controls.onMoveUp ? [{ label: 'Move up', onSelect: controls.onMoveUp }] : []),
              ...(controls.onMoveDown ? [{ label: 'Move down', onSelect: controls.onMoveDown }] : []),
              { label: 'Customize Home…', onSelect: controls.onCustomize },
            ]}
          />
        </div>
      )}
      {onScroll && (
        <div className="hidden md:flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button onClick={() => onScroll(-1)} tabIndex={-1} className={ARROW} aria-label="Scroll left">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button onClick={() => onScroll(1)} tabIndex={-1} className={ARROW} aria-label="Scroll right">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

/** Rise in as a row enters the viewport, once. A ref callback (not a ref +
 *  mount effect) so a row that first renders empty still reveals once it fills. */
export function useRevealOnce<T extends HTMLElement>() {
  const [visible, setVisible] = useState(false)
  const io = useRef<IntersectionObserver | null>(null)
  const ref = useCallback(
    (el: T | null) => {
      io.current?.disconnect()
      io.current = null
      if (!el || visible) return
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            setVisible(true)
            obs.disconnect()
          }
        },
        { threshold: 0.05, rootMargin: '0px 0px -8% 0px' },
      )
      obs.observe(el)
      io.current = obs
    },
    [visible],
  )
  useEffect(() => () => io.current?.disconnect(), [])
  return [ref, visible] as const
}

export const ROW_SCROLLER =
  'flex gap-3 sm:gap-4 overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-12 pb-2 scroll-smooth snap-x snap-proximity scroll-px-4 sm:scroll-px-6 lg:scroll-px-12 overscroll-x-contain'

export default function MediaRow({
  title,
  items,
  loading,
  seeAllHref,
  hideTitle,
  onDismissItem,
  canDismiss,
  variant = 'poster',
  minItems = 0,
  headerExtra,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sectionRef, visible] = useRevealOnce<HTMLElement>()

  if (!loading && (!items || items.length === 0 || items.length < minItems)) return null

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * scrollRef.current.clientWidth * 0.8, behavior: 'smooth' })
  }
  const dismissFor = (item: JfItem) => (onDismissItem && (!canDismiss || canDismiss(item)) ? onDismissItem : undefined)

  return (
    <section ref={sectionRef} className={`depth-row group/row relative reveal ${visible ? 'is-visible' : ''}`}>
      {!hideTitle && <RowHeader title={title} seeAllHref={seeAllHref} extra={headerExtra} onScroll={scrollBy} />}

      <div
        ref={scrollRef}
        className={ROW_SCROLLER}
      >
        {loading
          ? Array.from({ length: variant === 'wide' ? 5 : 8 }).map((_, i) =>
              variant === 'wide' ? <WideSkeleton key={i} /> : <CardSkeleton key={i} width={CARD_W} />,
            )
          : items!.map((item, i) =>
              variant === 'wide' ? (
                <WideCard key={item.Id} item={item} onDismiss={dismissFor(item)} />
              ) : variant === 'ranked' ? (
                <MediaCard key={item.Id} item={item} width={CARD_W} rank={i + 1} />
              ) : (
                <MediaCard key={item.Id} item={item} width={CARD_W} onDismiss={dismissFor(item)} />
              ),
            )}
      </div>
    </section>
  )
}
