// Local UI-only fixture. No media services, accounts, or production data change.
import http from 'node:http'
import { readFileSync } from 'node:fs'
const stateFile = new URL('./theme-fixture-state.json', import.meta.url)
const user = { Id: 'theme-fixture', Name: 'Theme Fixture', HasPassword: false, Policy: { IsAdministrator: false } }
http.createServer((req, res) => {
  const mode = JSON.parse(readFileSync(stateFile, 'utf8')).mode
  const path = new URL(req.url, 'http://localhost').pathname
  const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  if (path.endsWith('/api/finesse')) return send({ name: 'finesse', version: '3.2.5', mode: 'adopt', instanceId: 'theme-fixture', setup: { state: 'ready', needsCode: false }, features: {}, jellyfin: { path: '/jellyfin' } })
  if (path.endsWith('/Users/Public')) return send([user])
  if (path.endsWith('/Users/AuthenticateByName')) return send({ AccessToken: 'fixture-only-not-a-real-credential', User: user })
  if (path.endsWith('/Views')) return send({ Items: mode === 'no-libraries' ? [] : [{ Id: 'fixture-movies', Name: 'A very long library name for a quiet evening at home', CollectionType: 'movies' }], TotalRecordCount: mode === 'no-libraries' ? 0 : 1 })
  if (path.endsWith('/Items') && !path.endsWith('/Resume')) {
    if (mode === 'hang') return // Intentionally never answer: exercise the UI's deal deadline.
    if (mode === 'error') return send({ message: 'Intentional fixture outage' }, 503)
    const items = ['single', 'slow'].includes(mode) ? [{ Id: 'fixture-title', Name: 'An exceptionally long film title that still needs to be readable on a small screen', Type: 'Movie', Overview: 'A deliberately plain fixture without poster art, used to test a one-card library and long labels.', ProductionYear: 2026, RunTimeTicks: 54_000_000_000 }] : []
    if (mode === 'slow') return setTimeout(() => send({ Items: items, TotalRecordCount: items.length }), 3000)
    return send({ Items: items, TotalRecordCount: items.length })
  }
  if (path.includes('/DisplayPreferences/')) return send({ CustomPrefs: {} })
  if (path.includes('/groups/')) return send({ friends: [], servers: [] })
  if (path.endsWith('/Sessions')) return send([])
  if (path.endsWith('/System/Info/Public')) return send({ ServerName: 'Local theme fixture', Id: 'theme-fixture' })
  if (/\/Sessions\//.test(path)) return send({})
  if (path.endsWith('/version.json')) return send({ version: '3.2.5' })
  if (path.includes('/Items/Resume')) return send({ Items: [], TotalRecordCount: 0 })
  return send({ Items: [], TotalRecordCount: 0 })
}).listen(38212, '127.0.0.1', () => console.log('Theme fixture on 38212'))
