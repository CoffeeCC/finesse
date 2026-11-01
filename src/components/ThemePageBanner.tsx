import { Link } from 'react-router-dom'
import { useTheme } from '../lib/theme'

/** A shared material/wayfinding treatment; page titles and actions stay familiar. */
export default function ThemePageBanner({ label, compact = false }: { label: string; compact?: boolean }) {
  const theme = useTheme()
  if (theme !== 'card-table') return null
  return <div className={`arcane-page-banner ${compact ? 'arcane-banner-compact' : ''}`}>
    <span className="arcane-banner-crest" aria-hidden="true">✦</span>
    <span className="arcane-banner-label">{label}</span>
    <Link to="/" className="arcane-return">Return to table <span aria-hidden="true">↗</span></Link>
  </div>
}
