// Graphics and clips, the careful parts: an unknown look at the cards changes nothing, one failed
// test moves nothing, an app is never restarted while someone uses it, each app's plan is saved
// only once its container has it (a failed change is tried again, later each time), a card change
// keeps the image an app runs, the repair loop and the graphics pass never build the same
// container at once, the first plan leaves an administrator's own Jellyfin settings alone, and
// clips are pruned only when two listings agree (the manifest always matching the files).

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SettingsStore } from '../src/config.ts'
import { clipsWait, manifestsFor, pruneOrphans, writeManifestFiles } from '../src/stack/clips.ts'
import { Docker } from '../src/stack/docker.ts'
import { decodedBy, decodeScript, parseProbe, probeComplete, probeGpus, testCard } from '../src/stack/gpus.ts'
import { encodingFor, planGraphics, planKey, settleInventory, STRIKES, type Gpu, type Inventory } from '../src/stack/graphics.ts'
import { applyEncoding, GraphicsManager, jellyfinDefaults, retryDelay, type JellyfinGet } from '../src/stack/graphicsManager.ts'
import type { StackHost } from '../src/stack/host.ts'
import { pickJellyfin } from '../src/stack/jellyfinContainer.ts'
import { Maintainer } from '../src/stack/maintain.ts'
import { Orchestrator } from '../src/stack/orchestrator.ts'
import { capPlaybackInfo, convertsVideo } from '../src/transcodeCap.ts'
import { fakeDocker } from './fakeDocker.ts'
import { listen, tmp } from './helpers.ts'

const A = 'GPU-51512123-c030-4d28-adb9-c56e13629c77'
const B = 'GPU-4284af6d-29d0-4237-5d61-3302caf483ff'
const PROBE = `R renderD128 0x10de 0x2504 0000:01:00.0 nvidia -
R renderD129 0x10de 0x2503 0000:05:00.0 nvidia -
N
Model: NVIDIA GeForce RTX 3060
GPU UUID: ${A}
Bus Location: 0000:01:00.0
N
Model: NVIDIA GeForce RTX 3060
GPU UUID: ${B}
Bus Location: 0000:05:00.0
END
`

const nv = (uuid: string, pci: string, encodes: boolean | null = true): Gpu => ({ id: `nvidia:${uuid}`, vendor: 'nvidia', name: 'NVIDIA GeForce RTX 3060', integrated: false, pci, uuid, renderNode: '/dev/dri/renderD128', encodes, sessionLimit: 8, decode: ['h264'], vramMiB: 12288 })
const igpu = (encodes: boolean | null = true): Gpu => ({ id: 'dri:0000:00:02.0', vendor: 'intel', name: 'Intel graphics (built in)', integrated: true, pci: '0000:00:02.0', renderNode: '/dev/dri/renderD129', encodes, sessionLimit: null, decode: ['h264'] })
const inv = (gpus: Gpu[], extra: Partial<Inventory> = {}): Inventory => ({ checkedAt: new Date().toISOString(), gpus, nvidiaRuntime: true, complete: true, ...extra })

function store() {
  const dir = tmp()
  return new SettingsStore({ configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'i.db'), bakedWeb: dir, updatedWeb: dir, previews: dir, backups: dir })
}

// ---------- the look at the cards ----------

test('an empty probe, or Docker not answering info(), is "unknown", never "no cards"', async () => {
  assert.equal(probeComplete(''), false)
  assert.equal(probeComplete('END\n'), true)
  assert.equal(probeComplete(PROBE), true)
  let probe = ''
  let info: () => Promise<unknown> = async () => ({ Runtimes: { nvidia: {} } })
  const fd = await fakeDocker([], { run: (b) => ((b.Cmd ?? []).join(' ').includes('/host/sys/class/drm') ? probe : 'NVENC_OK\nMEM 12288') })
  try {
    const docker = new Docker(fd.socket)
    ;(docker as unknown as { info: () => Promise<unknown> }).info = () => info()
    const opts = { probeImage: 'finesse', testImage: null, inDocker: true }
    assert.equal((await probeGpus(docker, opts)).complete, false)
    probe = PROBE
    assert.equal((await probeGpus(docker, opts)).complete, true)
    info = async () => {
      throw new Error('docker down')
    }
    const noInfo = await probeGpus(docker, opts)
    assert.equal(noInfo.complete, false)
    assert.equal(noInfo.gpus.length, 0)
  } finally {
    await fd.close()
  }
})

test('a card an app uses stays through two failed tests and leaves on the third; a missing card leaves at once', () => {
  const inUse = [{ gpu: `nvidia:${A}`, uuid: A }, { gpu: `nvidia:${B}`, uuid: B }]
  const good = inv([nv(A, '0000:01:00.0'), nv(B, '0000:05:00.0')])
  const before = planKey(planGraphics(good, { streaming: true }))
  let failures: Record<string, number> = {}
  for (let run = 1; run <= STRIKES; run++) {
    const bad = inv([nv(A, '0000:01:00.0'), nv(B, '0000:05:00.0', false)], { checkedAt: `run ${run}` })
    const s = settleInventory(bad, { failures, inventory: good, inUse }, true)
    failures = s.failures
    const key = planKey(planGraphics(s.inv, { streaming: true }))
    if (run < STRIKES) assert.equal(key, before, `run ${run}`)
    else assert.notEqual(key, before)
  }
  assert.equal(failures[B], STRIKES)
  // The same probe kept from before doesn't count twice.
  const again = settleInventory(inv([nv(A, '0000:01:00.0'), nv(B, '0000:05:00.0', false)]), { failures: { [B]: 1 }, inventory: good, inUse }, false)
  assert.equal(again.failures[B], 1)
  // A pass resets the count; a test that couldn't run keeps what was known.
  assert.equal(settleInventory(good, { failures: { [B]: 2 }, inventory: good, inUse }, true).failures[B], undefined)
  const untested = settleInventory(inv([nv(A, '0000:01:00.0'), nv(B, '0000:05:00.0', null)]), { inventory: good, inUse }, true)
  assert.equal(untested.inv.gpus[1]!.encodes, true)
  // Gone from a probe that finished: gone, and its count with it.
  const gone = settleInventory(inv([nv(A, '0000:01:00.0')]), { failures: { [B]: 2 }, inventory: good, inUse }, true)
  assert.equal(gone.inv.gpus.length, 1)
  assert.equal(gone.failures[B], undefined)
})

test('an NVIDIA UUID the driver couldn’t read is never planned with', () => {
  const g = parseProbe('N\nModel: NVIDIA GeForce RTX 3060\nGPU UUID: GPU-????????-????-????-????-????????????\nBus Location: 0000:01:00.0\nEND\n')
  assert.equal(g[0]!.uuid, undefined)
  const p = planGraphics(inv(g.map((x) => ({ ...x, encodes: true }))), { streaming: true })
  assert.equal(p.jellyfin.gpu, null)
  assert.equal(p.wolf.gpu, null)
  // Even if one reached the planner.
  const p2 = planGraphics(inv([{ ...nv('GPU-????', '0000:01:00.0'), uuid: 'GPU-????' }]), { streaming: true })
  assert.equal(p2.wolf.gpu, null)
})

test('Intel/AMD cards are chosen by PCI address, and the render node is looked up when planning; an older choice by node still works', () => {
  const card: Gpu = { id: 'dri:0000:03:00.0', vendor: 'amd', name: 'AMD Radeon graphics card', integrated: false, pci: '0000:03:00.0', renderNode: '/dev/dri/renderD130', encodes: true, sessionLimit: null, decode: ['h264'] }
  const p = planGraphics(inv([igpu(), card]), { streaming: false, override: { jellyfin: 'dri:0000:03:00.0' } })
  assert.equal(p.jellyfin.gpu, 'dri:0000:03:00.0')
  assert.equal(p.jellyfin.renderNode, '/dev/dri/renderD130')
  const legacy = planGraphics(inv([igpu(), card]), { streaming: false, override: { jellyfin: 'dri:renderD130' } })
  assert.equal(legacy.jellyfin.gpu, 'dri:0000:03:00.0')
  assert.equal(legacy.notes.length, 0)
})

test('decoding: only what the card decoded in its test (and H.264), with 10-bit as its own switch', async () => {
  assert.deepEqual(decodedBy('VAAPI_OK\nDEC hevc\nDEC av1\nDEC bogus\n', ['h264']), ['h264', 'hevc', 'av1'])
  assert.match(decodeScript('-hwaccel vaapi -hwaccel_device /dev/dri/renderD128 -hwaccel_output_format vaapi'), /hwdownload,format=\$4/)
  const enc = encodingFor({ accel: 'vaapi', decode: ['h264', 'hevc', 'hevc-10bit', 'vp9'], renderNode: '/dev/dri/renderD128' })
  assert.deepEqual(enc.HardwareDecodingCodecs, ['h264', 'hevc', 'vp9'])
  assert.equal(enc.EnableDecodingColorDepth10Hevc, true)
  assert.equal(enc.EnableDecodingColorDepth10Vp9, false)
  const fd = await fakeDocker([], { run: () => 'VAAPI_OK\nDEC hevc\n' })
  try {
    const r = await testCard(new Docker(fd.socket), 'jellyfin/jellyfin', igpu(null))
    assert.equal(r.encodes, true)
    assert.deepEqual(r.decode, ['h264', 'hevc'])
    const body = Object.values(fd.created)[0]
    assert.equal(body.Labels['finesse.role'], 'helper')
  } finally {
    await fd.close()
  }
  // Docker not answering is no test at all, not a failed card.
  const down = await testCard(new Docker(join(tmp(), 'nothing.sock')), 'jellyfin/jellyfin', igpu(null))
  assert.equal(down.encodes, null)
})

// ---------- applying the plan ----------

async function rig(opts: { containers?: Parameters<typeof fakeDocker>[0]; encoding?: Record<string, unknown>; services?: ('jellyfin' | 'wolf')[] } = {}) {
  let probe = PROBE
  const fd = await fakeDocker(opts.containers ?? [], {
    run: (body) => {
      const cmd = (body.Cmd ?? []).join(' ')
      if (cmd.includes('/host/sys/class/drm')) return probe
      if (cmd.includes('h264_nvenc')) return 'NVENC_OK\nMEM 12288'
      return '/dev/dri\n/dev/nvidia0\n'
    },
  })
  let enc = { HardwareAccelerationType: 'none', ...opts.encoding }
  const posts: unknown[] = []
  const jf = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    if (req.method === 'POST') {
      enc = JSON.parse(Buffer.concat(chunks).toString())
      posts.push(enc)
      res.writeHead(204)
      return void res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(enc))
  })
  const jfUrl = await listen(jf)
  const settings = store()
  const dir = settings.paths.configDir
  settings.update((x) => {
    x.mode = 'bundle'
    x.jellyfin = { url: jfUrl, apiKey: 'k', basePath: '' }
    x.stack = { hostRoot: dir, hostData: join(dir, 'data'), timezone: 'UTC', puid: 1000, pgid: 1000, services: opts.services ?? ['jellyfin', 'wolf'], streaming: { nvidia: true } }
  })
  const before = process.env.FINESSE_IN_DOCKER
  process.env.FINESSE_IN_DOCKER = '1'
  const docker = new Docker(fd.socket)
  ;(docker as unknown as { info: () => Promise<unknown> }).info = async () => ({ Runtimes: { nvidia: {} } })
  const orch = new Orchestrator(docker, 'mine')
  orch.waitReady = async () => {}
  let busy: (id: string) => Promise<string | null> = async () => null
  const events: string[] = []
  const g = new GraphicsManager(settings, orch, (_l, m) => events.push(m), { inUse: (id) => busy(id) })
  return {
    fd,
    g,
    orch,
    settings,
    posts,
    events,
    setProbe: (p: string) => (probe = p),
    setBusy: (f: typeof busy) => (busy = f),
    close: async () => {
      if (before === undefined) delete process.env.FINESSE_IN_DOCKER
      else process.env.FINESSE_IN_DOCKER = before
      jf.close()
      await fd.close()
    },
  }
}
let r: Awaited<ReturnType<typeof rig>>

test('nobody is restarted mid-use: Jellyfin waits while someone watches, its settings with it, and the next tick finishes the job', async () => {
  r = await rig()
  try {
    r.setBusy(async (id) => (id === 'jellyfin' ? 'someone is watching on Jellyfin' : null))
    const first = await r.g.apply('test', { refresh: true })
    assert.equal(first!.built!.jellyfin, undefined)
    assert.equal(first!.built!.wolf!.uuid, A)
    assert.equal(r.fd.created['finesse-jellyfin'], undefined)
    assert.ok(r.fd.created['finesse-wolf'])
    assert.equal(r.posts.length, 0)
    assert.match(first!.pending!.why, /watching/)
    assert.equal(r.g.due(), true)
    // Still watching at the next tick: still waiting, and no new look at the cards.
    const probes = () => Object.keys(r.fd.created).filter((n) => n.startsWith('finesse-probe-')).length
    const looked = probes()
    await r.g.apply('trying again', { retry: true })
    assert.equal(probes(), looked)
    assert.equal(r.fd.created['finesse-jellyfin'], undefined)
    // They stopped: Jellyfin gets its card, then its settings.
    r.setBusy(async () => null)
    const done = await r.g.apply('trying again', { retry: true })
    assert.equal(done!.built!.jellyfin!.uuid, B)
    assert.deepEqual(r.fd.created['finesse-jellyfin']!.HostConfig.DeviceRequests[0].DeviceIDs, [B])
    assert.equal(r.posts.length, 1)
    assert.equal(done!.pending, null)
    assert.equal(probes(), looked)
  } finally {
    await r.close()
  }
})

test('a failed rebuild saves nothing for that app, skips Jellyfin’s settings, and is tried again later each time', async () => {
  r = await rig()
  try {
    const real = r.orch.ensureService.bind(r.orch)
    r.orch.ensureService = async (id, ctx, p, o) => {
      if (id === 'jellyfin') throw new Error('could not select device driver')
      return real(id, ctx, p, o)
    }
    const t0 = Date.now()
    const first = await r.g.apply('test', { refresh: true })
    assert.equal(first!.built!.jellyfin, undefined)
    assert.equal(first!.built!.wolf!.uuid, A)
    assert.equal(r.posts.length, 0)
    assert.equal(first!.pending!.attempts, 1)
    assert.ok(Date.parse(first!.pending!.next) >= t0 + retryDelay(1) - 1000)
    assert.equal(r.g.due(), false)
    // What builds Jellyfin next (the repair loop, setup) still builds it as it was.
    const { stackContext } = await import('../src/setup/apply.ts')
    assert.equal(stackContext(r.settings.get(), [])!.graphics!.jellyfin, undefined)
    const second = await r.g.apply('trying again', { retry: true })
    assert.equal(second!.pending!.attempts, 2)
    assert.ok(Date.parse(second!.pending!.next) >= Date.now() + retryDelay(2) - 1000)
    assert.ok(retryDelay(2) > retryDelay(1))
  } finally {
    await r.close()
  }
})

test('a card change keeps the image the app runs now (pending pins wait for the update flow)', async () => {
  r = await rig({ containers: [{ id: 'jfc', name: 'finesse-jellyfin', image: 'jellyfin/jellyfin:10.10.0', labels: { 'finesse.managed': 'true', 'finesse.service': 'jellyfin', 'finesse.instance': 'mine' } }], services: ['jellyfin'] })
  try {
    await r.g.apply('test', { refresh: true })
    assert.equal(r.fd.created['finesse-jellyfin'].Image, 'jellyfin/jellyfin:10.10.0')
  } finally {
    await r.close()
  }
})

test('an administrator’s choice made during a pass isn’t dropped: another pass follows with it', async () => {
  r = await rig()
  try {
    let open!: () => void
    const gate = new Promise<void>((res) => (open = res))
    let first = true
    r.setBusy(async () => {
      if (first) {
        first = false
        await gate
      }
      return null
    })
    const nightly = r.g.apply('nightly check', { refresh: true })
    await new Promise((res) => setTimeout(res, 50))
    assert.equal(r.g.isWorking, true)
    r.settings.update((x) => void (x.graphicsOverride = { wolf: `nvidia:${B}` }))
    const chosen = r.g.apply('chosen by an administrator')
    open()
    await nightly
    const g = await chosen
    assert.equal(g!.plan.wolf.uuid, B)
    assert.equal(g!.built!.wolf!.uuid, B)
  } finally {
    await r.close()
  }
})

test('the inventory kept for 30 minutes is kept per test image, and an unfinished look isn’t kept', async () => {
  r = await rig()
  try {
    const probes = () => Object.keys(r.fd.created).filter((n) => n.startsWith('finesse-probe-')).length
    await r.orch.graphicsInventory('img-a')
    const n = probes()
    await r.orch.graphicsInventory('img-a')
    assert.equal(probes(), n)
    await r.orch.graphicsInventory(null)
    assert.ok(probes() > n)
    r.setProbe('')
    const m = probes()
    assert.equal((await r.orch.graphicsInventory('img-b')).complete, false)
    await r.orch.graphicsInventory('img-b')
    assert.ok(probes() > m + 1)
  } finally {
    await r.close()
  }
})

test('the first plan leaves Jellyfin’s own video settings alone (and offers Finesse’s); Jellyfin’s defaults are set', async () => {
  const fake = (cur: Record<string, unknown>) => {
    const posts: unknown[] = []
    const get: JellyfinGet = async (_p, init) => (init?.method === 'POST' ? (posts.push(init.body), { status: 204, json: null }) : { status: 200, json: { ...cur } })
    return { get, posts }
  }
  const plan = { jellyfin: { gpu: 'nvidia:x', name: 'x', vendor: null, accel: 'nvenc' as const, decode: ['h264'], maxTranscodes: 8, shared: false, why: '' } }
  const own = fake({ HardwareAccelerationType: 'qsv', QsvDevice: '/dev/dri/renderD128' })
  const r1 = await applyEncoding(own.get, plan, { planChanged: true })
  assert.equal(own.posts.length, 0)
  assert.equal(r1.applied, null)
  assert.equal(r1.offer, true)
  // The administrator's click.
  await applyEncoding(own.get, plan, { planChanged: true, force: true })
  assert.equal(own.posts.length, 1)
  const fresh = fake({ HardwareAccelerationType: 'none', HardwareDecodingCodecs: ['h264', 'vc1'], EnableTonemapping: false, VaapiDevice: '/dev/dri/renderD128', QsvDevice: '' })
  assert.equal(jellyfinDefaults({ HardwareAccelerationType: 'none', HardwareDecodingCodecs: ['h264', 'vc1'], VaapiDevice: '/dev/dri/renderD128' }), true)
  await applyEncoding(fresh.get, plan, { planChanged: true })
  assert.equal(fresh.posts.length, 1)
})

// ---------- the repair loop ----------

function fakeHost(opts: { ensure?: (id: string) => Promise<boolean> } = {}) {
  const calls: string[] = []
  const host = {
    kind: 'docker',
    ping: async () => true,
    hostDevices: async () => [],
    prepareNetwork: async () => {},
    state: async () => null,
    ensureService: async (id: string) => {
      calls.push(`ensure ${id}`)
      return opts.ensure ? opts.ensure(id) : true
    },
    start: async () => {},
    restart: async () => {},
    isRunning: async () => false,
    url: () => 'http://127.0.0.1:9',
    logs: async () => '',
  } as unknown as StackHost
  return { host, calls }
}

function bundle(settings: SettingsStore, extra: (x: ReturnType<SettingsStore['get']>) => void = () => {}) {
  const dir = settings.paths.configDir
  settings.update((x) => {
    x.mode = 'bundle'
    x.stack = { hostRoot: dir, hostData: join(dir, 'data'), timezone: 'UTC', puid: 1000, pgid: 1000, services: ['jellyfin'] }
    extra(x)
  })
}

test('repair leaves Jellyfin to a running graphics pass, and waits for the container lock', async () => {
  const settings = store()
  bundle(settings)
  const { host, calls } = fakeHost()
  const m = new Maintainer(settings, host, settings.paths)
  let working = true
  Object.defineProperty(m.graphics, 'isWorking', { get: () => working })
  await m.tick()
  assert.deepEqual(calls, [])
  working = false
  let release!: () => void
  const held = m.graphics.lock('jellyfin', () => new Promise<void>((res) => (release = res)))
  const tick = m.tick()
  await new Promise((res) => setTimeout(res, 50))
  assert.deepEqual(calls, [])
  release()
  await held
  await tick
  assert.deepEqual(calls, ['ensure jellyfin'])
})

test('Jellyfin that won’t start with its card re-plans with backoff, without forcing a new look at the cards', async () => {
  const settings = store()
  const plan = planGraphics(inv([nv(A, '0000:01:00.0')]), { streaming: false })
  bundle(settings, (x) => {
    x.stack!.graphics = { plan, key: planKey(plan), at: '', built: { jellyfin: plan.jellyfin } }
  })
  const { host } = fakeHost({
    ensure: async () => {
      throw new Error('nvidia-container-cli: device error')
    },
  })
  const m = new Maintainer(settings, host, settings.paths)
  const asked: unknown[] = []
  m.graphics.apply = async (_r, o) => {
    asked.push(o ?? {})
    return settings.get().stack!.graphics!
  }
  await m.tick()
  await m.tick()
  await m.tick()
  assert.equal(asked.length, 1)
  assert.ok(!(asked[0] as { refresh?: boolean }).refresh)
})

// ---------- helpers ----------

test('helper containers carry this Finesse’s stamp, are swept at startup (its own only), and are never taken for Jellyfin', async () => {
  const fd = await fakeDocker([
    { id: 'h1', name: 'finesse-clip-1', image: 'jellyfin/jellyfin', labels: { 'finesse.managed': 'true', 'finesse.service': 'clip', 'finesse.role': 'helper', 'finesse.instance': 'mine' } },
    { id: 'h2', name: 'finesse-clip-2', image: 'jellyfin/jellyfin', labels: { 'finesse.managed': 'true', 'finesse.service': 'clip', 'finesse.role': 'helper', 'finesse.instance': 'theirs' } },
    { id: 'app', name: 'finesse-jellyfin', image: 'jellyfin/jellyfin', labels: { 'finesse.managed': 'true', 'finesse.service': 'jellyfin', 'finesse.instance': 'mine' } },
  ])
  try {
    const docker = new Docker(fd.socket)
    new Orchestrator(docker, 'mine')
    assert.equal(await docker.sweepHelpers(), 1)
    assert.deepEqual(fd.calls.filter((c) => c.startsWith('remove')), ['remove h1'])
    await docker.runOnce('img', ['true'])
    const probe = Object.values(fd.created)[0]
    assert.equal(probe.Labels['finesse.instance'], 'mine')
    assert.equal(probe.Labels['finesse.role'], 'helper')
  } finally {
    await fd.close()
  }
  const c = (Id: string, labels: Record<string, string> = {}) => ({ Id, Names: [`/${Id}`], Image: 'jellyfin/jellyfin:10.11', State: 'running', Status: '', Labels: labels })
  const picked = pickJellyfin([c('theirs-jf'), c('clip', { 'finesse.managed': 'true', 'finesse.service': 'clip', 'finesse.role': 'helper', 'finesse.instance': 'mine' }), c('old-clip', { 'finesse.managed': 'true', 'finesse.service': 'clip' })], 'http://10.0.0.9:8096', { instance: 'mine' })
  assert.deepEqual(picked, { id: 'theirs-jf', how: 'the only Jellyfin container running' })
})

// ---------- the conversion cap, clips at night ----------

test('the cap lets a play through that only converts the sound, as it doesn’t count one', () => {
  const audio = '/videos/x/master.m3u8?VideoCodec=h264&AudioCodec=aac&allowVideoStreamCopy=true&TranscodeReasons=AudioCodecNotSupported'
  const video = '/videos/x/master.m3u8?VideoCodec=h264&TranscodeReasons=VideoCodecNotSupported,AudioCodecNotSupported'
  assert.equal(convertsVideo(audio), false)
  assert.equal(convertsVideo(video), true)
  assert.equal(convertsVideo('/videos/x/master.m3u8?VideoCodec=h264'), true)
  const t = (url: string) => JSON.stringify({ MediaSources: [{ SupportsDirectPlay: false, SupportsDirectStream: false, TranscodingUrl: url }] })
  assert.equal(JSON.parse(capPlaybackInfo(t(audio), 1, 1)).ErrorCode, undefined)
  assert.equal(JSON.parse(capPlaybackInfo(t(video), 1, 1)).ErrorCode, 'RateLimitExceeded')
})

test('no graphics card: clips wait for the night', () => {
  const settings = store()
  const plan = planGraphics(inv([]), { streaming: false })
  bundle(settings, (x) => void (x.stack!.graphics = { plan, key: planKey(plan), at: '' }))
  const at = (h: number) => new Date(2026, 10, 1, h, 30)
  assert.match(clipsWait(settings.get(), at(15))!, /at night/)
  assert.equal(clipsWait(settings.get(), at(3)), null)
  const withCard = planGraphics(inv([nv(A, '0000:01:00.0')]), { streaming: false })
  settings.update((x) => void (x.stack!.graphics = { plan: withCard, key: planKey(withCard), at: '' }))
  assert.equal(clipsWait(settings.get(), at(15)), null)
})

// ---------- clips: pruning and the manifest ----------

test('clips are pruned only when two listings agree, and never after the library shrank by over a tenth', () => {
  const id = (n: number) => n.toString(16).padStart(32, 'a')
  const names = [`${id(1)}.mp4`, `${id(2)}.mp4`, `${id(2)}.720.mp4`]
  const all = new Set(Array.from({ length: 100 }, (_, i) => id(i + 1)))
  const without2 = new Set([...all].filter((x) => x !== id(2)))
  let st = pruneOrphans(names, all, {})
  assert.deepEqual(st.remove, [])
  st = pruneOrphans(names, without2, st.next)
  assert.deepEqual(st.remove, [])
  assert.deepEqual(st.next.candidates, [id(2)])
  const again = pruneOrphans(names, without2, st.next)
  assert.deepEqual(again.remove, [`${id(2)}.mp4`, `${id(2)}.720.mp4`])
  // Back in the next listing: no longer a candidate.
  assert.deepEqual(pruneOrphans(names, all, st.next).remove, [])
  // A partial listing (half the library) prunes nothing, even of earlier candidates.
  const half = new Set([...all].slice(0, 50))
  const partial = pruneOrphans(names, half, { count: 100, candidates: [id(2)] })
  assert.equal(partial.skipped, true)
  assert.deepEqual(partial.remove, [])
})

test('the manifest is rebuilt from the files, swapped in whole, and never written empty while clips are there', () => {
  const dir = tmp()
  const id = (n: number) => n.toString(16).padStart(32, 'a')
  writeFileSync(join(dir, `${id(1)}.mp4`), 'x')
  writeFileSync(join(dir, `${id(2)}.mp4`), 'x')
  writeFileSync(join(dir, `${id(2)}.720.mp4`), 'x')
  writeFileSync(join(dir, `.${id(3)}.mp4.part`), 'x')
  assert.equal(writeManifestFiles(dir), true)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')), [id(1), id(2)])
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'manifest-hd.json'), 'utf8')), { [id(2)]: [720] })
  assert.ok(!existsSync(join(dir, '.manifest.json.tmp')))
  // Only HD tiers left (the base clips went): an empty manifest would hide them all, so the old one stays.
  const dir2 = tmp()
  mkdirSync(dir2, { recursive: true })
  writeFileSync(join(dir2, 'manifest.json'), JSON.stringify([id(5)]))
  writeFileSync(join(dir2, `${id(5)}.720.mp4`), 'x')
  assert.equal(writeManifestFiles(dir2), false)
  assert.deepEqual(JSON.parse(readFileSync(join(dir2, 'manifest.json'), 'utf8')), [id(5)])
  // No clips at all: an empty manifest is the truth.
  const dir3 = tmp()
  assert.equal(writeManifestFiles(dir3), true)
  assert.deepEqual(JSON.parse(readFileSync(join(dir3, 'manifest.json'), 'utf8')), [])
  assert.deepEqual(manifestsFor(['.x.mp4', 'notes.txt']).base, [])
})
