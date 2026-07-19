import { createPortal } from 'react-dom'

const ALL_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

interface Props {
  /** Letters that actually exist in the library */
  available: Set<string>
  active?: string
  onJump: (letter: string) => void
}

// Portaled to <body>: the route wrapper (.page-enter) animates a transform, and
// a transformed ancestor becomes the containing block for position:fixed — the
// rail would render at its document-flow position (miles down the grid) any
// time the transform is live (route entrance, or indefinitely on a TV that
// pauses/throttles the animation). From <body> it is always truly viewport-fixed.
export default function AlphabetRail({ available, active, onJump }: Props) {
  return createPortal(
    <div
      className={`fixed top-1/2 -translate-y-1/2 z-40 hidden lg:flex flex-col items-center gap-px py-2 px-0.5 rounded-full bg-ink-900/70 backdrop-blur-md border border-white/5 shadow-xl shadow-black/30
        ${__WEBOS__ ? 'right-10' : 'right-1.5'} max-h-[92vh]`}
    >
      {ALL_LETTERS.map((letter) => {
        const has = available.has(letter)
        const isActive = active === letter
        return (
          <button
            key={letter}
            disabled={!has}
            onClick={() => onJump(letter)}
            aria-label={`Jump to ${letter}`}
            className={`group relative w-5 flex-1 basis-[18px] min-h-[11px] max-h-[18px] text-[10px] font-semibold rounded transition-all leading-none active:scale-90 outline-none focus-visible:ring-2 focus-visible:ring-accent-400 ${
              isActive
                ? 'text-white bg-accent-500 shadow-[0_0_12px_rgba(98,121,205,0.6)]'
                : has
                  ? 'text-ink-400 hover:text-white hover:bg-white/10 focus-visible:text-white focus-visible:bg-white/10'
                  : 'text-ink-700 cursor-default'
            }`}
          >
            {letter}
            {/* Pop-out bubble on hover or D-pad focus, phone-contacts style */}
            {has && (
              <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 transition-all duration-150 origin-right rounded-xl bg-accent-500 text-white text-lg font-bold h-10 w-10 flex items-center justify-center shadow-2xl shadow-black/50">
                {letter}
              </span>
            )}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
