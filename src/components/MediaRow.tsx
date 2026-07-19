import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MediaCard from './MediaCard'
import { CardSkeleton } from './Skeletons'
import type { JfItem } from '../api/types'

interface Props {
  title: string
  items: JfItem[] | undefined
  loading?: boolean
  seeAllHref?: string
  /** Hide the row's own title bar (used when an outer frame already shows it). */
  hideTitle?: boolean
  /** Show a hover “×” on each card that calls this (e.g. drop from Continue Watching). */
  onDismissItem?: (item: JfItem) => void
}

export default function MediaRow({ title, items, loading, seeAllHref, hideTitle, onDismissItem }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  // Rise in as the row enters the viewport, once
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (!loading && (!items || items.length === 0)) return null

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * scrollRef.current.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <section ref={sectionRef} className={`group/row relative reveal ${visible ? 'is-visible' : ''}`}>
      {!hideTitle && (
      <div className="flex items-baseline justify-between px-4 sm:px-6 lg:px-12 mb-3">
        {seeAllHref ? (
          <Link
            to={seeAllHref}
            className="group/title row-title flex items-baseline gap-2 text-xl text-white hover:text-accent-300 transition-colors"
          >
            {title}
            <span className="text-xs font-medium text-accent-300 opacity-0 group-hover/row:opacity-100 transition-opacity">
              See all →
            </span>
          </Link>
        ) : (
          <h2 className="row-title text-xl text-white">{title}</h2>
        )}
        <div className="hidden md:flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button
            onClick={() => scrollBy(-1)}
            tabIndex={-1}
            className="h-8 w-8 rounded-full bg-ink-800 hover:bg-ink-700 flex items-center justify-center text-ink-200 transition-colors"
            aria-label="Scroll left"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            onClick={() => scrollBy(1)}
            tabIndex={-1}
            className="h-8 w-8 rounded-full bg-ink-800 hover:bg-ink-700 flex items-center justify-center text-ink-200 transition-colors"
            aria-label="Scroll right"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>
      )}

      <div
        ref={scrollRef}
        className="flex gap-3 sm:gap-4 overflow-x-auto no-scrollbar px-4 sm:px-6 lg:px-12 pb-2 scroll-smooth"
      >
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} width={176} />)
          : items!.map((item) => (
              <MediaCard key={item.Id} item={item} width={176} onDismiss={onDismissItem} />
            ))}
      </div>
    </section>
  )
}
