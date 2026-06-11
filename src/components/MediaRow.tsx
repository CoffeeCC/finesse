import { useEffect, useRef, useState } from 'react'
import MediaCard from './MediaCard'
import { CardSkeleton } from './Skeletons'
import type { JfItem } from '../api/types'

interface Props {
  title: string
  items: JfItem[] | undefined
  loading?: boolean
}

export default function MediaRow({ title, items, loading }: Props) {
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
      <div className="flex items-baseline justify-between px-6 lg:px-12 mb-3">
        <h2 className="text-lg font-semibold text-white tracking-tight">{title}</h2>
        <div className="hidden md:flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button
            onClick={() => scrollBy(-1)}
            className="h-8 w-8 rounded-full bg-ink-800 hover:bg-ink-700 flex items-center justify-center text-ink-200 transition-colors"
            aria-label="Scroll left"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            onClick={() => scrollBy(1)}
            className="h-8 w-8 rounded-full bg-ink-800 hover:bg-ink-700 flex items-center justify-center text-ink-200 transition-colors"
            aria-label="Scroll right"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto no-scrollbar px-6 lg:px-12 pb-2 scroll-smooth"
      >
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} width={176} />)
          : items!.map((item) => <MediaCard key={item.Id} item={item} width={176} />)}
      </div>
    </section>
  )
}
