import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import ArcaneLighting from './ArcaneLighting'
import dispatch from '../assets/card-table/dispatch-seal-v1-still.webp'
import rings from '../assets/card-table/linked-rings-v1-still.webp'
import memory from '../assets/card-table/memory-vessel-v1-still.webp'
import './arcane-correspondence.css'
import { useMyLimits } from '../api/parental'
import { useQueuesOn } from '../api/queues'

const destinations = [
  { to: '/request', label: 'Requests', hint: 'Send a dispatch', art: dispatch, kind: 'dispatch' },
  { to: '/friends', label: 'Groups', hint: 'Connected libraries', art: rings, kind: 'groups' },
  { to: '/moments', label: 'Moments', hint: 'Collected memories', art: memory, kind: 'memory' },
]
export default function ArcaneCorrespondence({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const limits = useMyLimits(), together = useQueuesOn()
  const heading = pathname.startsWith('/request') ? 'The dispatch desk.' : pathname.startsWith('/moments') ? 'A vessel for your memories.'
    : pathname.startsWith('/together') ? 'Gather your company.' : pathname.startsWith('/activity') ? 'The chronicle.' : 'Across the realms.'
  return <div className="arcane-correspondence" data-arcane-family="correspondence" data-arcane-scene="correspondence">
    <section className="correspondence-desk" aria-label="Correspondence desk">
      <ArcaneLighting workspace />
      <div className="correspondence-heading"><p>THE CELESTIAL CORRESPONDENCE</p><p className="correspondence-title">{heading}</p><Link to="/">← Return to the table</Link></div>
      <nav className="correspondence-trinkets" aria-label="Correspondence navigation">
        {destinations.filter((d) => d.to !== '/request' || !limits || limits.requests).map((d) => <NavLink key={d.to} to={d.to} end={false} className="correspondence-trinket">
          <span className={`${d.kind}-trinket-art correspondence-trinket-art`} aria-hidden="true"><img src={d.art} alt="" /></span>
          <span>{d.label}<small>{d.hint}</small></span>
        </NavLink>)}
      </nav>
      <div className="correspondence-secondary">{together && <NavLink to="/together">Watch together</NavLink>}<NavLink to="/activity">Activity ledger</NavLink></div>
    </section>
    <div className="correspondence-ledger">{children}</div>
  </div>
}
