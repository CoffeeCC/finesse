import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCandle } from '../lib/candle'
import './arcane-theme-lab.css'

/** Imported only in Vite development. No controls or accelerated settings ship in production. */
export default function ArcaneThemeLab() {
  const candle = useCandle(), [message, setMessage] = useState(''), [counts, setCounts] = useState({ canvases: 0, cards: 0 })
  useEffect(() => {
    const sample = () => setCounts({ canvases: document.querySelectorAll('.arcane-lighting canvas').length, cards: document.querySelectorAll('.live-card-ready').length })
    sample(); const timer = setInterval(sample, 1000); return () => clearInterval(timer)
  }, [])
  const quick = new URLSearchParams(location.search).get('candle-test') === '1'
  return createPortal(<aside className="arcane-theme-lab" aria-label="Local theme lab">
    <strong>Local theme lab · development</strong>
    <p role="status">Candle: {candle.phase} · {Math.round(candle.burned / 1000)}s<br />Scene canvases: {counts.canvases} · Live cards: {counts.cards}</p>
    <p>{quick ? 'Accelerated: 14s burn, 8s idle, 6s gutter.' : 'Normal: 45 minute burn, 2 minute idle guard.'}</p>
    <div><button onClick={() => {
      const url = new URL(location.href); if (quick) url.searchParams.delete('candle-test'); else url.searchParams.set('candle-test', '1'); location.assign(url.href)
    }}>{quick ? 'Normal candle' : 'Accelerated candle'}</button><button onClick={() => {
      let changed = false
      document.querySelectorAll<HTMLCanvasElement>('.arcane-lighting canvas').forEach((canvas) => {
        const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
        if (extension) { extension.loseContext(); changed = true }
      })
      setMessage(changed ? 'Graphics context lost; original artwork should remain usable.' : 'This browser does not expose the context-loss test extension.')
    }}>Test graphics fallback</button><button onClick={() => location.reload()}>Reload scene</button></div>
    {message && <p role="status">{message}</p>}
  </aside>, document.body)
}
