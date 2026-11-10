import { Link } from 'react-router-dom'
import { useResume } from '../api/queries'
import { posterUrl } from '../api/client'

/** The alternate Home keeps Continue Watching, as ongoing quests. */
export default function TableReservations() {
  const resume = useResume()
  const items = resume.data?.Items.slice(0, 3) ?? []
  if (!items.length) return null
  return (
    <section className="desk-continuations" aria-labelledby="reservations-heading">
      <h2 id="reservations-heading">Continue your journey</h2>
      <div className="desk-resume-hand">
        {items.map((item) => {
          const title = item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name
          const art = posterUrl(item)
          const percent = item.RunTimeTicks && item.UserData?.PlaybackPositionTicks
            ? Math.max(0, Math.min(100, item.UserData.PlaybackPositionTicks / item.RunTimeTicks * 100)) : 0
          return (
            <Link key={item.Id} className="desk-resume-card" to={`/play/${item.Id}`} aria-label={`Resume ${title}${item.Type === 'Episode' ? `, ${item.Name}` : ''}`}>
              <span className="resume-playing-card"><span className="card-art">{art ? <img src={art} alt="" loading="lazy" /> : <i aria-hidden>F</i>}</span></span>
              <strong>{title}</strong><span className="resume-progress" aria-label={`${Math.round(percent)} percent watched`}><span style={{ width: `${percent}%` }} /></span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
