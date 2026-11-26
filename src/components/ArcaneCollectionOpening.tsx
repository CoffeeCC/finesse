import { Link } from 'react-router-dom'
import desk from '../assets/card-table/quiet-desk-v1.webp'
import wide from '../assets/card-table/collection-folio-art-v1.webp'
import portrait from '../assets/card-table/collection-folio-portrait-v2.webp'
import { arcaneTrinkets } from '../lib/arcaneTrinkets'
import './arcane-collection-opening.css'

export default function ArcaneCollectionOpening({ error, onRetry, title }: { error?: string; onRetry?: () => void; title?: string }) {
  return <div className="arcane-collection-opening" style={{ backgroundImage: `url(${desk})` }}>
    <picture aria-hidden="true"><source media="(max-width:759px)" srcSet={portrait} /><img src={wide} alt="" /></picture>
    <div className="collection-opening-writing" role={error ? 'alert' : 'status'}><h1>{error ? 'The folio is quiet.' : title ? `Opening ${title.toLowerCase()}…` : 'Opening your collection…'}</h1>{error && <p>{error}</p>}{onRetry && <button className="collection-opening-leaf" onClick={onRetry}><span aria-hidden="true" />Turn the leaf again</button>}</div>
    <Link className="collection-opening-stone" to="/" aria-label="Return to the table"><img src={arcaneTrinkets.home} alt="" /><span>Return to table</span></Link>
  </div>
}
