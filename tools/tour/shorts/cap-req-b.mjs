// Requests Short, take B (real time, K=1): the real Request page with STAGED queue data.
// The demo's fake indexer can't deliver a real file, so the Radarr queue + downloader status responses are
// mocked (progressing over ~60 s), then the placeholder file is really imported by Radarr (fulfil.py --place).
import { stage, login, recorder, director, sleep, APP, VW } from './common.mjs'
import { exec } from 'node:child_process'
const OUT = `${process.env.SHORTS_OUT || 'shorts-out'}/take-req-b`
const DL = 60, SIZE = 8.2e9
const { browser, page, context } = await stage()
const d = director(page)
let movie = null, t0 = 0, imported = false
await context.route(/\/arr\/radarr\/wanted\/missing/, async (route) => {
  const res = await route.fetch(); const j = await res.json()
  movie = movie || (j.records || []).find((m) => m.title === 'The Iron Giant') || null
  await route.fulfill({ response: res, json: j })
})
await context.route(/\/arr\/radarr\/queue/, async (route) => {
  if (!movie || !t0) return route.fulfill({ json: { page: 1, pageSize: 200, totalRecords: 0, records: [] } })
  const p = Math.min(1, (Date.now() / 1000 - t0) / DL)
  const done = p >= 1
  const rec = { id: 901, movieId: movie.id, title: 'The Iron Giant', size: SIZE, sizeleft: Math.round(SIZE * (1 - p)),
    status: done ? 'completed' : 'downloading', trackedDownloadState: done ? 'importPending' : 'downloading', trackedDownloadStatus: 'ok',
    movie: { id: movie.id, title: movie.title, year: movie.year, images: movie.images } }
  console.log('queue', Math.round(p * 100))
  await route.fulfill({ json: { page: 1, pageSize: 200, totalRecords: 1, records: [rec] } })
})
await context.route(/\/arr\/sab\?/, async (route) => {
  const u = new URL(route.request().url())
  if (u.searchParams.get('mode') !== 'queue') return route.fulfill({ json: { status: true } })
  const p = t0 && !imported ? Math.min(1, (Date.now() / 1000 - t0) / DL) : 1
  const active = p < 1
  const left = Math.round(DL * (1 - p)); const tl = `0:${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
  await route.fulfill({ json: { queue: { paused: false, kbpersec: active ? String(SIZE / DL / 1024) : '0', speedlimit_abs: '0', diskspace1: '1843.2', noofslots: active ? 1 : 0, timeleft: tl } } })
})
await login(page)
t0 = Date.now() / 1000 + 6
await page.goto(`${APP}/request`); await page.locator('h1', { hasText: 'Request' }).waitFor()
await sleep(4000)
const sab = page.getByText(/GB free/).first()
await sab.waitFor({ timeout: 20000 }).catch(() => console.log('no sab panel'))
const sb = await sab.boundingBox().catch(() => null)
if (sb) await page.evaluate((y) => window.scrollTo({ top: y }), sb.y - 150)
await page.mouse.move(VW - 10, 120)
const r = recorder(page, OUT)
await r.start()
while (Date.now() / 1000 < t0 + DL + 12) await sleep(500)
r.mark('placing')
const placed = new Promise((res) => exec(process.env.SHORTS_PLACE_CMD || 'true', (e, so, se) => { console.log(so, se); res() }))
await placed
imported = true
r.mark('imported')
await sleep(4000)
await r.stop()
await browser.close()
