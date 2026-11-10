// Local UI-only fixture. No media services, accounts, or production data change.
import http from 'node:http'
import { readFileSync } from 'node:fs'
const stateFile = process.env.THEME_FIXTURE_STATE || new URL('./theme-fixture-state.json', import.meta.url)
const user = { Id: 'theme-fixture', Name: 'Theme Fixture', HasPassword: false, Policy: { IsAdministrator: false } }
const fixtureTitle = { Id: 'fixture-title', Name: 'An exceptionally long film title that still needs to be readable on a small screen', Type: 'Movie', Overview: 'A deliberately plain fixture without poster art, used to test a one-card library and long labels.', ProductionYear: 2026, RunTimeTicks: 54_000_000_000 }
const fixtureHand = ['The Amber Gate', 'A Lantern at Dusk', 'The Astronomer’s Map', 'Letters from the North', 'The Midnight Archive']
  .map((Name, index) => ({ ...fixtureTitle, Id: `fixture-hand-${index}`, Name }))
const initialDispatch = () => ({ id: 101, movieId: 10, movie: { id: 10, title: 'Fixture Courier', images: [] }, title: 'fixture-release', size: 1000, sizeleft: 300, status: 'downloading', trackedDownloadState: 'importFailed', protocol: 'usenet', downloadId: 'fixture-nzo', statusMessages: [{ title: 'Fixture import problem', messages: ['This is disposable fixture data.'] }] })
let dispatches = [initialDispatch()], events = [], lastMode = 'single'
http.createServer((req, res) => {
  let mode = lastMode
  try { mode = JSON.parse(readFileSync(stateFile, 'utf8')).mode } catch { /* Preserve the last mode while a developer replaces the state file. */ }
  if (mode !== lastMode) { dispatches = [initialDispatch()]; events = []; lastMode = mode }
  const url = new URL(req.url, 'http://localhost'), path = url.pathname
  const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  if (path === '/__fixture/events') return send({ events, remaining: dispatches.length })
  if (path === '/__fixture/reset' && req.method === 'POST') { dispatches = [initialDispatch()]; events = []; return send({ ok: true }) }
  if (mode === 'dispatch' && path.endsWith('/arr/radarr/queue')) return send({ records: dispatches })
  if (mode === 'dispatch' && /\/arr\/(sonarr|lidarr)\/queue$/.test(path)) return send({ records: [] })
  if (mode === 'dispatch' && path.endsWith('/arr/sab')) {
    const action = url.searchParams.get('name')
    if (action === 'pause' || action === 'resume') {
      events.push({ action, id: url.searchParams.get('value') })
      dispatches = dispatches.map(row => ({ ...row, status: action === 'pause' ? 'paused' : 'downloading' }))
      return send({ status: true })
    }
    return send({ queue: { paused: false, noofslots: dispatches.length, kbpersec: '0', mbleft: '0' } })
  }
  if (mode === 'dispatch' && (path.endsWith('/arr/radarr/queue/bulk') || path.endsWith('/arr/radarr/command'))) {
    let body = ''; req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const payload = body ? JSON.parse(body) : {}
      if (req.method === 'DELETE') { events.push({ action: 'remove', blocklist: url.searchParams.get('blocklist'), ids: payload.ids }); dispatches = [] }
      else { events.push({ action: 'search', name: payload.name, ids: payload.movieIds }); dispatches = [{ ...initialDispatch(), id: 102, trackedDownloadState: undefined, sizeleft: 1000 }] }
      send({ status: true })
    }); return
  }
  if (path.endsWith('/api/finesse')) return send({ name: 'finesse', version: '3.2.5', mode: 'adopt', instanceId: 'theme-fixture', setup: { state: 'ready', needsCode: false }, features: {}, jellyfin: { path: '/jellyfin' } })
  if (path.endsWith('/Users/Public')) return send([user])
  if (path.endsWith('/Users/AuthenticateByName')) return send({ AccessToken: 'fixture-only-not-a-real-credential', User: user })
  if (path.endsWith('/Views')) {
    if(mode==='views-error')return send({message:'Intentional fixture outage'},503)
    const items=mode==='no-libraries'?[]:mode==='vault-shelves'?Array.from({length:9},(_,i)=>({Id:`fixture-${i}`,Name:`Shelf story library ${i+1}`,CollectionType:i%2?'tvshows':'movies'})):[{ Id: 'fixture-movies', Name: 'A very long library name for a quiet evening at home', CollectionType: 'movies' }]
    return send({Items:items,TotalRecordCount:items.length})
  }
  if (path.endsWith('/Items') && !path.endsWith('/Resume')) {
    if (mode === 'hang') return // Intentionally never answer: exercise the UI's deal deadline.
    if (mode === 'error') return send({ message: 'Intentional fixture outage' }, 503)
    const items = mode === 'hand' ? fixtureHand : ['single', 'slow', 'dispatch'].includes(mode) ? [fixtureTitle] : []
    if (mode === 'slow') return setTimeout(() => send({ Items: items, TotalRecordCount: items.length }), 3000)
    return send({ Items: items, TotalRecordCount: items.length })
  }
  if (path.endsWith('/Items/fixture-title')) return send(fixtureTitle)
  if (path.includes('/DisplayPreferences/')) return send({ CustomPrefs: mode === 'dispatch' && path.includes('finesse-watchlist') ? { watchlist: '["fixture-title"]' } : {} })
  if (path.includes('/groups/')) return send({ friends: [], servers: [] })
  if (path.endsWith('/Sessions')) return send([])
  if (path.endsWith('/System/Info/Public')) return send({ ServerName: 'Local theme fixture', Id: 'theme-fixture' })
  if (/\/Sessions\//.test(path)) return send({})
  if (path.endsWith('/version.json')) return send({ version: '3.2.5' })
  if (path.includes('/Items/Resume')) return send({ Items: [], TotalRecordCount: 0 })
  return send({ Items: [], TotalRecordCount: 0 })
}).listen(38212, '127.0.0.1', () => console.log('Theme fixture on 38212'))
