const ALL_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

interface Props {
  /** Letters that actually exist in the library */
  available: Set<string>
  active?: string
  onJump: (letter: string) => void
}

export default function AlphabetRail({ available, active, onJump }: Props) {
  return (
    <div className="fixed right-1.5 top-1/2 -translate-y-1/2 z-40 hidden lg:flex flex-col items-center gap-px py-2 px-0.5 rounded-full bg-ink-900/80 backdrop-blur border border-white/5">
      {ALL_LETTERS.map((letter) => {
        const has = available.has(letter)
        return (
          <button
            key={letter}
            disabled={!has}
            onClick={() => onJump(letter)}
            className={`w-5 h-[18px] text-[10px] font-semibold rounded transition-colors leading-none ${
              active === letter
                ? 'text-white bg-accent-500'
                : has
                  ? 'text-ink-400 hover:text-white hover:bg-white/10'
                  : 'text-ink-700 cursor-default'
            }`}
          >
            {letter}
          </button>
        )
      })}
    </div>
  )
}
