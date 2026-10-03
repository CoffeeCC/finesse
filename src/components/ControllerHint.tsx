import { useEffect, useRef, useState } from 'react'
import { useController, type PadKind } from '../lib/gamepad'

// What the face buttons are called on the controller in hand.
const GLYPHS: Record<PadKind, { ok: string; back: string; search: string }> = {
  xbox: { ok: 'A', back: 'B', search: 'Y' },
  generic: { ok: 'A', back: 'B', search: 'Y' },
  nintendo: { ok: 'B', back: 'A', search: 'X' },
  playstation: { ok: '✕', back: '○', search: '△' },
}

const NAMES: Record<PadKind, string> = { xbox: 'Xbox controller', playstation: 'PlayStation controller', nintendo: 'Nintendo controller', generic: 'Controller' }

function Glyph({ children }: { children: string }) {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-white/70 font-mono text-[13px] font-semibold text-white">
      {children}
    </span>
  )
}

/** A moment's note when a controller is picked up: which buttons do what. */
export default function ControllerHint() {
  const pad = useController()
  const [shown, setShown] = useState<PadKind | null>(null)
  const last = useRef<PadKind | null>(null)
  useEffect(() => {
    if (!pad || pad.kind === last.current) return
    last.current = pad.kind
    setShown(pad.kind)
    const t = window.setTimeout(() => setShown(null), 5000)
    return () => window.clearTimeout(t)
  }, [pad])
  if (!shown) return null
  const g = GLYPHS[shown]
  return (
    <div role="status" className="fixed left-1/2 top-20 z-[80] -translate-x-1/2 os-sheet-in">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-full bg-ink-900/90 os-glass px-5 py-3 text-[14px] text-white/85">
        <span className="font-semibold text-white">{NAMES[shown]}</span>
        <span className="inline-flex items-center gap-2"><Glyph>{g.ok}</Glyph>Select</span>
        <span className="inline-flex items-center gap-2"><Glyph>{g.back}</Glyph>Back</span>
        <span className="inline-flex items-center gap-2"><Glyph>{g.search}</Glyph>Search</span>
        <span className="inline-flex items-center gap-2"><Glyph>≡</Glyph>Quick menu</span>
        <span className="inline-flex items-center gap-2"><Glyph>L</Glyph><Glyph>R</Glyph>Tabs</span>
      </div>
    </div>
  )
}
