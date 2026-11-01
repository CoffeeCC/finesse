import { useQuery } from '@tanstack/react-query'
import { queuePeople } from '../api/queues'

/** People with a profile on this server (not you), as toggles. */
export default function PeoplePicker({ chosen, onChange }: { chosen: string[]; onChange: (ids: string[]) => void }) {
  const { data: people, isLoading } = useQuery({ queryKey: ['queues', 'people'], queryFn: queuePeople, staleTime: 60_000 })
  if (isLoading) return <p className="text-sm text-ink-400">Loading people…</p>
  if (!people?.length) return <p className="text-sm text-ink-400">Nobody else has a profile on this server yet.</p>
  return (
    <div className="flex flex-wrap gap-2">
      {people.map((p) => {
        const on = chosen.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-sm transition-colors ${on ? 'bg-white font-semibold text-ink-950' : 'border border-white/15 text-ink-200 hover:text-white'}`}
          >
            {p.name}
          </button>
        )
      })}
    </div>
  )
}
