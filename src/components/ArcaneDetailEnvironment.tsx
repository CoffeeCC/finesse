import ArcaneLighting from './ArcaneLighting'
import { useEffect, useState } from 'react'
import './arcane-folio.css'
import ArcaneSearchTrinket from './ArcaneSearchTrinket'

export default function ArcaneDetailEnvironment() {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width:759px)').matches)
  useEffect(() => { const media = matchMedia('(max-width:759px)'), update = () => setNarrow(media.matches); media.addListener(update); return () => media.removeListener(update) }, [])
  return <><div className="arcane-detail-world" aria-hidden="true"><ArcaneLighting folio staticOnly={narrow} /></div><ArcaneSearchTrinket className="arcane-detail-search" /></>
}
