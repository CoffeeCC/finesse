import { Link } from 'react-router-dom'
import { useResume } from '../api/queries'
import { posterUrl } from '../api/client'

/** The alternate Home keeps Continue Watching, as ongoing quests. */
export default function TableReservations() {
  const resume = useResume()
  const items = resume.data?.Items.slice(0, 3) ?? []
  if (!items.length) return null
  return (
    <section className="table-reservations" aria-labelledby="reservations-heading">
      <div className="reservation-heading"><p className="table-kicker">YOUR ADVENTURE CONTINUES</p><h2 id="reservations-heading">Pick up your journey.</h2></div>
      <div className="reservation-list">
        {items.map((item) => {
          const title = item.Type === 'Episode' ? item.SeriesName ?? item.Name : item.Name
          const art = posterUrl(item)
          const percent = item.RunTimeTicks && item.UserData?.PlaybackPositionTicks
            ? Math.max(0, Math.min(100, item.UserData.PlaybackPositionTicks / item.RunTimeTicks * 100)) : 0
          return (
            <Link key={item.Id} className="reservation-ticket" to={`/play/${item.Id}`} aria-label={`Resume ${title}${item.Type === 'Episode' ? `, ${item.Name}` : ''}`}>
              <span className="reservation-art">{art ? <img src={art} alt="" loading="lazy" /> : <i aria-hidden>F</i>}</span>
              <span className="reservation-copy"><small>IN PROGRESS</small><strong>{title}</strong><span>{item.Type === 'Episode' ? item.Name : 'Continue watching'} <b aria-hidden>↗</b></span><span className="reservation-progress" aria-label={`${Math.round(percent)} percent watched`}><span style={{ width: `${percent}%` }} /></span></span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
