// Download rescue (server/src/downloadRescue.ts): the rules for what counts as stuck and what
// to do about it, and the loop acting on a fake Sonarr: a stalled torrent is swapped once its
// wait is up, a problem only a person can fix is never swapped, and a title stops being swapped
// after three tries in a day.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { after, before, test } from 'node:test'
import { DownloadRescue, MAX_SWAPS, NO_PROGRESS_MS, diagnose, type QueueRecord } from '../src/downloadRescue.ts'
import { listen } from './helpers.ts'
import { call, fakeJellyfin, finesse } from './peers.ts'

const HOUR = 3600_000
const warn = (msg: string, extra: Partial<QueueRecord> = {}): QueueRecord => ({ id: 1, status: 'downloading', trackedDownloadStatus: 'warning', protocol: 'torrent', sizeleft: 10, statusMessages: [{ title: 'x', messages: [msg] }], ...extra })

test('a healthy download is left alone', () => {
  assert.equal(diagnose({ id: 1, status: 'downloading', trackedDownloadStatus: 'ok', protocol: 'usenet', sizeleft: 5 }), null)
  assert.equal(diagnose({ id: 1, status: 'queued', protocol: 'torrent', sizeleft: 5 }), null)
  assert.equal(diagnose({ id: 1, status: 'completed', trackedDownloadState: 'importPending', trackedDownloadStatus: 'ok' }), null)
})

test('a stalled torrent is swapped after an hour, or the wait chosen in Settings', () => {
  const d = diagnose(warn('The download is stalled with no connections'))
  assert.deepEqual([d?.problem, d?.action, d?.waitMs], ['stalled', 'swap', HOUR])
  assert.equal(diagnose(warn('The download is stalled with no connections'), 0, 4 * HOUR)?.waitMs, 4 * HOUR)
})

test('a finished download that can’t be imported is swapped after an hour', () => {
  const d = diagnose(warn('One or more episodes expected in this release were not imported or missing from the release', { status: 'completed', trackedDownloadState: 'importBlocked' }))
  assert.deepEqual([d?.problem, d?.action, d?.waitMs], ['import', 'swap', HOUR])
})

test('something the library already has is cleared, not replaced', () => {
  const d = diagnose(warn('Not an upgrade for existing movie file(s)', { status: 'completed', trackedDownloadState: 'importFailed' }))
  assert.deepEqual([d?.problem, d?.action], ['not-needed', 'drop'])
})

test('what only a person can fix is reported, never swapped', () => {
  for (const msg of ['Access to the path "/data/media/tv" is denied', 'Not enough free space on /data', 'Remote path mapping is wrong', 'Import failed, path does not exist or is not accessible by Sonarr']) {
    const d = diagnose(warn(msg, { status: 'completed', trackedDownloadState: 'importFailed' }))
    assert.deepEqual([d?.problem, d?.action], ['needs-person', 'report'], msg)
  }
})

test('a failed download is swapped straight away', () => {
  const d = diagnose({ id: 1, status: 'failed', protocol: 'usenet', errorMessage: 'Aborted, cannot be completed' })
  assert.deepEqual([d?.problem, d?.action, d?.waitMs], ['failed', 'swap', 0])
})

test('a torrent that hasn’t moved for hours counts as stuck, a Usenet one doesn’t', () => {
  const quiet: QueueRecord = { id: 1, status: 'downloading', trackedDownloadStatus: 'ok', protocol: 'torrent', sizeleft: 5 }
  assert.equal(diagnose(quiet, NO_PROGRESS_MS - 1), null)
  assert.equal(diagnose(quiet, NO_PROGRESS_MS)?.problem, 'slow')
  assert.equal(diagnose({ ...quiet, protocol: 'usenet' }, NO_PROGRESS_MS * 2), null)
})

// ---------- The loop, against a fake Sonarr ----------

let sonarr: { url: string; server: Server; queue: QueueRecord[]; calls: { method: string; url: string; body: unknown }[]; delay: Record<string, unknown> }
let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let F: Awaited<ReturnType<typeof finesse>>
let rescue: DownloadRescue

before(async () => {
  const state = { queue: [] as QueueRecord[], calls: [] as { method: string; url: string; body: unknown }[], delay: { id: 1, enableUsenet: true, enableTorrent: true, preferredProtocol: 'usenet', tags: [] } as Record<string, unknown> }
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : null
    const url = req.url ?? ''
    if (req.method !== 'GET') state.calls.push({ method: req.method!, url, body })
    let out: unknown = {}
    if (url.startsWith('/api/v3/queue?')) out = { records: state.queue }
    else if (url.startsWith('/api/v3/queue/bulk')) state.queue = state.queue.filter((r) => !(body.ids as number[]).includes(r.id!))
    else if (url === '/api/v3/delayprofile') out = [state.delay]
    else if (url === '/api/v3/delayprofile/1' && req.method === 'PUT') state.delay = body
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out))
  })
  sonarr = Object.assign(state, { url: await listen(server), server })
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'd-admin', admin: true }, { name: 'robin', token: 'd-robin', admin: false }], 'd-service')
  F = await finesse('dd', jf, 'd-service')
  F.settings.update((s) => {
    s.services.sonarr = { url: sonarr.url, apiKey: 'sonarr-secret-key' }
  })
  rescue = new DownloadRescue(F.settings)
})
after(() => {
  for (const s of [F.app, jf.server, sonarr.server]) {
    s.closeAllConnections()
    s.close()
  }
})

const stalled = (id: number, episodeId: number): QueueRecord => ({ id, downloadId: `hash${id}`, protocol: 'torrent', status: 'downloading', trackedDownloadStatus: 'warning', seriesId: 7, episodeId, sizeleft: 100, series: { title: 'Firefly' }, statusMessages: [{ title: 'r', messages: ['The download is stalled with no connections'] }] })

test('a stalled torrent waits its hour, then is dropped, blocked and searched for again', async () => {
  sonarr.queue = [stalled(11, 501)]
  const t0 = Date.now()
  await rescue.tick(t0)
  assert.equal(sonarr.calls.length, 0, 'nothing happens before the wait is up')
  const w = rescue.status().watching[0]!
  assert.equal(w.key, 'series-7')
  assert.equal(w.title, 'Firefly')
  assert.equal(Date.parse(w.dueAt!), t0 + HOUR)

  await rescue.tick(t0 + HOUR + 1)
  assert.equal(sonarr.calls.length, 2)
  assert.match(sonarr.calls[0]!.url, /\/queue\/bulk\?removeFromClient=true&blocklist=true&skipRedownload=true/)
  assert.deepEqual(sonarr.calls[0]!.body, { ids: [11] })
  assert.deepEqual(sonarr.calls[1]!.body, { name: 'EpisodeSearch', episodeIds: [501] })
  const s = rescue.status()
  assert.equal(s.watching.length, 0)
  assert.deepEqual([s.log[0]!.what, s.log[0]!.key, s.log[0]!.problem, s.log[0]!.via], ['swapped', 'series-7', 'stalled', 'torrent'])
})

test('a download that starts moving again is forgotten', async () => {
  sonarr.calls.length = 0
  sonarr.queue = [stalled(12, 502)]
  const t0 = Date.now() + 10 * HOUR
  await rescue.tick(t0)
  sonarr.queue = [{ ...stalled(12, 502), trackedDownloadStatus: 'ok', statusMessages: [], sizeleft: 50 }]
  await rescue.tick(t0 + HOUR / 2)
  sonarr.queue = [stalled(12, 502)]
  await rescue.tick(t0 + HOUR + 5)
  assert.equal(sonarr.calls.length, 0, 'its wait started again when it stalled again')
  sonarr.queue = []
  await rescue.tick(t0 + 3 * HOUR)
})

test('a problem only a person can fix is never swapped', async () => {
  sonarr.calls.length = 0
  sonarr.queue = [{ id: 20, downloadId: 'h20', protocol: 'usenet', status: 'completed', trackedDownloadStatus: 'warning', trackedDownloadState: 'importFailed', seriesId: 8, episodeId: 600, series: { title: 'South Park' }, statusMessages: [{ title: 'r', messages: ['Access to the path "/data/media/tv" is denied'] }] }]
  const t0 = Date.now() + 40 * HOUR
  await rescue.tick(t0)
  await rescue.tick(t0 + 48 * HOUR)
  assert.equal(sonarr.calls.length, 0)
  const w = rescue.status().watching[0]!
  assert.deepEqual([w.problem, w.action, w.dueAt], ['needs-person', 'report', undefined])
  sonarr.queue = []
})

test(`after ${MAX_SWAPS} swaps in a day a title is left for a person`, async () => {
  sonarr.calls.length = 0
  const fresh = new DownloadRescue(F.settings)
  let now = Date.now() + 200 * HOUR
  for (let i = 0; i < MAX_SWAPS; i++) {
    sonarr.queue = [{ ...stalled(30 + i, 700), seriesId: 9 }]
    await fresh.tick(now)
    now += HOUR + 1
    await fresh.tick(now)
  }
  assert.equal(sonarr.calls.filter((c) => c.method === 'DELETE').length, MAX_SWAPS)
  sonarr.calls.length = 0
  sonarr.queue = [{ ...stalled(40, 700), seriesId: 9 }]
  await fresh.tick(now)
  await fresh.tick(now + 3 * HOUR)
  assert.equal(sonarr.calls.length, 0)
  const w = fresh.status().watching[0]!
  assert.deepEqual([w.exhausted, w.swaps, w.dueAt], [true, MAX_SWAPS, undefined])
  assert.equal(fresh.status().log[0]!.what, 'gave-up')
  sonarr.queue = []
})

test('switched off, it watches but doesn’t act', async () => {
  sonarr.calls.length = 0
  F.settings.update((s) => {
    s.downloads = { autoFix: false }
  })
  const off = new DownloadRescue(F.settings)
  sonarr.queue = [{ ...stalled(50, 800), seriesId: 10 }]
  const t0 = Date.now() + 400 * HOUR
  await off.tick(t0)
  await off.tick(t0 + 5 * HOUR)
  assert.equal(sonarr.calls.length, 0)
  assert.equal(off.status().watching[0]!.dueAt, undefined)
  F.settings.update((s) => {
    s.downloads = { autoFix: true }
  })
  sonarr.queue = []
})

test('the page can read it; only an admin can change it, and the order is set in the app', async () => {
  const r = await call(F.url, 'GET', '/api/downloads/auto', 'd-robin')
  assert.equal(r.status, 200, r.text)
  assert.deepEqual([r.data.enabled, r.data.prefer, r.data.maxSwaps, r.data.stalledMinutes], [true, 'usenet', MAX_SWAPS, 60])
  assert.equal((await call(F.url, 'GET', '/api/downloads/auto')).status, 401)
  assert.equal((await call(F.url, 'PUT', '/api/downloads/auto', 'd-robin', { enabled: false })).status, 403)
  assert.equal((await call(F.url, 'PUT', '/api/downloads/auto', 'd-admin', { prefer: 'carrier pigeon' })).status, 400)

  assert.equal((await call(F.url, 'PUT', '/api/downloads/auto', 'd-admin', { stalledMinutes: 2 })).status, 400)

  const p = await call(F.url, 'PUT', '/api/downloads/auto', 'd-admin', { prefer: 'torrent', enabled: false, stalledMinutes: 240 })
  assert.equal(p.status, 200, p.text)
  assert.deepEqual([p.data.enabled, p.data.prefer, p.data.stalledMinutes], [false, 'torrent', 240])
  assert.deepEqual([F.settings.get().downloads?.prefer, F.settings.get().downloads?.stalledMinutes], ['torrent', 240])
  assert.equal(sonarr.delay.preferredProtocol, 'torrent')
  assert.equal(F.settings.get().downloads?.autoFix, false)
  assert.ok(!p.text.includes('sonarr-secret-key'))
})

test('a torrent that fails outright is replaced on the next look, with nobody asked', async () => {
  sonarr.calls.length = 0
  F.settings.update((s) => {
    s.downloads = { autoFix: true }
  })
  const quick = new DownloadRescue(F.settings)
  sonarr.queue = [{ id: 60, downloadId: 'h60', protocol: 'torrent', status: 'failed', seriesId: 11, episodeId: 950, series: { title: 'Deep Field' }, errorMessage: 'The torrent was removed' }]
  await quick.tick(Date.now() + 900 * HOUR)
  assert.deepEqual(sonarr.calls.map((c) => c.method), ['DELETE', 'POST'])
  assert.deepEqual(sonarr.calls[1]!.body, { name: 'EpisodeSearch', episodeIds: [950] })
  sonarr.queue = []
})

test('with Usenet and torrents both set up, the apps are kept on Usenet first unless Finesse was told otherwise', async () => {
  sonarr.calls.length = 0
  sonarr.delay.preferredProtocol = 'torrent'
  F.settings.update((s) => {
    s.services.sabnzbd = { url: 'http://sab.invalid', apiKey: 'k' }
    s.services.qbittorrent = { url: 'http://qbit.invalid', username: 'a', password: 'b' }
    s.downloads = { autoFix: true }
  })
  const both = new DownloadRescue(F.settings)
  const t0 = Date.now() + 1200 * HOUR
  await both.tick(t0)
  assert.equal(sonarr.delay.preferredProtocol, 'usenet')
  assert.equal(sonarr.calls.filter((c) => c.method === 'PUT').length, 1)
  await both.tick(t0 + 2 * HOUR)
  assert.equal(sonarr.calls.filter((c) => c.method === 'PUT').length, 1, 'already so: nothing written again')
  F.settings.update((s) => {
    s.downloads = { autoFix: true, prefer: 'torrent' }
  })
  await both.tick(t0 + 4 * HOUR)
  assert.equal(sonarr.delay.preferredProtocol, 'torrent')
})
