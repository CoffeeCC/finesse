import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useFinesse } from '../lib/finesseServer'
import { readDrop } from '../lib/mediaSort'
import { addDropped } from '../pages/AddMediaPage'

/** Files dragged over any page (administrators, on servers Finesse set up): drop them, and they're on their way to the library. */
export default function DropToAdd() {
  const { session } = useAuth()
  const { info } = useFinesse()
  const navigate = useNavigate()
  const location = useLocation()
  const [shown, setShown] = useState(false)
  const depth = useRef(0)
  const on = Boolean(session?.isAdmin && info?.features?.addMedia) && location.pathname !== '/add-media'

  useEffect(() => {
    if (!on) return
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current += 1
      setShown(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setShown(false)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return
      e.preventDefault()
      depth.current = 0
      setShown(false)
      const dt = e.dataTransfer
      void readDrop(dt).then((items) => {
        addDropped(items, Boolean(info?.features?.games))
        navigate('/add-media')
      })
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [on, info, navigate])

  if (!on || !shown) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[90] grid place-items-center bg-ink-950/75 p-6 backdrop-blur-md" aria-hidden>
      <div className="flex flex-col items-center gap-4 rounded-[2rem] border-2 border-dashed border-accent-300/70 bg-accent-500/10 px-14 py-12 text-center shadow-[0_0_80px_rgba(117,137,216,.35)]">
        <svg viewBox="0 0 24 24" className="h-12 w-12 text-accent-300" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" />
          <path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" />
        </svg>
        <p className="font-display text-[34px] leading-none text-white">Drop to add to your library</p>
        <p className="text-[14px] text-ink-200">Movies, shows, music and games: files or whole folders</p>
      </div>
    </div>
  )
}
