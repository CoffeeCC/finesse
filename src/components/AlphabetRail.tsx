const ALL_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

interface Props {
  /** Letters that actually exist in the library */
  available: Set<string>
  active?: string
  onJump: (letter: string) => void
}

export default function AlphabetRail({ available, active, onJump }: Props) {
  return (
    <div className="fixed right-1.5 top-1/2 -translate-y-1/2 z-40 hidden lg:flex flex-col items-center gap-px py-2 px-0.5 rounded-full bg-ink-900/70 backdrop-blur-md border border-white/5 shadow-xl shadow-black/30">
      {ALL_LETTERS.map((letter) => {
        const has = available.has(letter)
        const isActive = active === letter
        return (
          <button
            key={letter}
            disabled={!has}
            onClick={() => onJump(letter)}
            className={`group relative w-5 h-[18px] text-[10px] font-semibold rounded transition-all leading-none active:scale-90 ${
              isActive
                ? 'text-white bg-accent-500 shadow-[0_0_12px_rgba(98,121,205,0.6)]'
                : has
                  ? 'text-ink-400 hover:text-white hover:bg-white/10'
                  : 'text-ink-700 cursor-default'
            }`}
          >
            {letter}
            {/* Pop-out bubble on hover, phone-contacts style */}
            {has && (
              <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-150 origin-right rounded-xl bg-accent-500 text-white text-lg font-bold h-10 w-10 flex items-center justify-center shadow-2xl shadow-black/50">
                {letter}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
