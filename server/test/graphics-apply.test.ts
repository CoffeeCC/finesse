// Graphics on servers Finesse set up: the containers get exactly their card (and change only when
// the plan does), Jellyfin's encoding settings are set without touching anything else, a card that
// fails or vanishes takes the apps back to another card or the processor, and the conversion cap.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { SettingsStore } from '../src/config.ts'
import { CATALOG, type StackContext } from '../src/stack/catalog.ts'
import { Docker } from '../src/stack/docker.ts'
import { applyEncoding, GraphicsManager, type JellyfinGet } from '../src/stack/graphicsManager.ts'
import { containerSpec, Orchestrator, specHash } from '../src/stack/orchestrator.ts'
import { capPlaybackInfo, deviceOf } from '../src/transcodeCap.ts'
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
`

const ctx = (extra: Partial<StackContext> = {}): StackContext => ({
  hostRoot: '/srv/finesse',
  hostData: '/srv/finesse/data',
  puid: 1000,
  pgid: 1000,
  timezone: 'UTC',
  network: 'finesse',
  exposeJellyfin: false,
  jellyfinPort: 8096,
  gpu: true,
  gpuGroups: ['107'],
  hostDevices: ['/dev/dri', '/dev/nvidia0', '/dev/uinput', '/dev/uhid'],
  streaming: { nvidia: true },
  ...extra,
})

const none = { gpu: null, accel: 'none' as const }

test('specs: unchanged without a plan; with one, each app gets exactly its card', () => {
  // Before any plan: byte for byte what earlier versions built (no container is recreated by the upgrade).
  const legacy = containerSpec(CATALOG.jellyfin, ctx()) as any
  assert.deepEqual(legacy.HostConfig.Devices, [{ PathOnHost: '/dev/dri', PathInContainer: '/dev/dri', CgroupPermissions: 'rwm' }])
  assert.equal(legacy.HostConfig.DeviceRequests, undefined)
  const wolfLegacy = containerSpec(CATALOG.wolf, ctx()) as any
  assert.deepEqual(wolfLegacy.HostConfig.DeviceRequests, [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }])
  assert.ok(wolfLegacy.Env.includes('NVIDIA_VISIBLE_DEVICES=all'))

  const planned = ctx({ graphics: { jellyfin: { gpu: `nvidia:${B}`, accel: 'nvenc', uuid: B, renderNode: '/dev/dri/renderD129' }, wolf: { gpu: `nvidia:${A}`, accel: 'nvenc', uuid: A, renderNode: '/dev/dri/renderD128' } } })
  const jf = containerSpec(CATALOG.jellyfin, planned) as any
  assert.deepEqual(jf.HostConfig.DeviceRequests, [{ Driver: 'nvidia', DeviceIDs: [B], Capabilities: [['gpu']] }])
  assert.ok(jf.Env.includes(`NVIDIA_VISIBLE_DEVICES=${B}`))
  assert.ok(jf.Env.includes('NVIDIA_DRIVER_CAPABILITIES=compute,video,utility'))
  assert.deepEqual(jf.HostConfig.Devices, [])
  assert.deepEqual(jf.HostConfig.GroupAdd, [])
  const wolf = containerSpec(CATALOG.wolf, planned) as any
  assert.deepEqual(wolf.HostConfig.DeviceRequests, [{ Driver: 'nvidia', DeviceIDs: [A], Capabilities: [['gpu']] }])
  assert.ok(wolf.Env.includes(`NVIDIA_VISIBLE_DEVICES=${A}`))
  assert.ok(wolf.Env.includes('WOLF_RENDER_NODE=/dev/dri/renderD128'))
  assert.ok(![...jf.Env, ...wolf.Env].includes('NVIDIA_VISIBLE_DEVICES=all'))

  // Intel for Jellyfin: one render node, the render group; nothing from NVIDIA.
  const qsv = containerSpec(CATALOG.jellyfin, ctx({ graphics: { jellyfin: { gpu: 'dri:renderD128', accel: 'qsv', renderNode: '/dev/dri/renderD128' }, wolf: none } })) as any
  assert.deepEqual(qsv.HostConfig.Devices, [{ PathOnHost: '/dev/dri/renderD128', PathInContainer: '/dev/dri/renderD128', CgroupPermissions: 'rwm' }])
  assert.deepEqual(qsv.HostConfig.GroupAdd, ['107'])
  assert.equal(qsv.HostConfig.DeviceRequests, undefined)
  // The processor: no devices at all, so the container starts whatever cards come and go.
  const cpu = containerSpec(CATALOG.jellyfin, ctx({ graphics: { jellyfin: none, wolf: none } })) as any
  assert.deepEqual(cpu.HostConfig.Devices, [])
  assert.equal(cpu.HostConfig.DeviceRequests, undefined)
  const wolfCpu = containerSpec(CATALOG.wolf, ctx({ graphics: { jellyfin: none, wolf: none } })) as any
  assert.equal(wolfCpu.HostConfig.DeviceRequests, undefined)
  // The same plan, the same hash: nothing is recreated twice.
  assert.equal(specHash(containerSpec(CATALOG.jellyfin, planned)), specHash(containerSpec(CATALOG.jellyfin, planned)))
  assert.notEqual(specHash(jf), specHash(cpu))
})

/** A Jellyfin answering its encoding settings, recording what was posted. */
function fakeEncoding(initial: Record<string, unknown>) {
  let cur = { ...initial }
  const posts: Record<string, unknown>[] = []
  const get: JellyfinGet = async (_path, init) => {
    if (init?.method === 'POST') {
      cur = init.body as Record<string, unknown>
      posts.push(cur)
      return { status: 204, json: null }
    }
    return { status: 200, json: { ...cur } }
  }
  return { get, posts, cur: () => cur, set: (k: string, v: unknown) => (cur[k] = v) }
}

const plan = (accel: 'nvenc' | 'none') => ({ jellyfin: { gpu: accel === 'none' ? null : 'nvidia:x', name: 'NVIDIA GeForce RTX 3060', vendor: null, accel, decode: accel === 'none' ? [] : ['h264', 'hevc'], maxTranscodes: 8, shared: false, why: '' } })

test('Jellyfin’s settings: set once, idempotent, never other keys, and someone’s own change is left alone', async () => {
  const jf = fakeEncoding({ HardwareAccelerationType: 'none', EncoderPreset: 'slow', TranscodingTempPath: '/cache/t', EnableTonemapping: false })
  const first = await applyEncoding(jf.get, plan('nvenc'), { planChanged: true })
  assert.equal(jf.posts.length, 1)
  assert.equal(jf.cur().HardwareAccelerationType, 'nvenc')
  assert.equal(jf.cur().EncoderPreset, 'slow')
  assert.equal(jf.cur().TranscodingTempPath, '/cache/t')
  // Again: nothing to change, nothing posted.
  const again = await applyEncoding(jf.get, plan('nvenc'), { last: first.applied!, planChanged: false })
  assert.deepEqual(again.changed, [])
  assert.equal(jf.posts.length, 1)
  // An administrator switched tone mapping off in Jellyfin: Finesse leaves it while the plan stands…
  jf.set('EnableTonemapping', false)
  const left = await applyEncoding(jf.get, plan('nvenc'), { last: first.applied!, planChanged: false })
  assert.equal(left.applied, null)
  assert.match(left.note!, /changed Jellyfin’s video conversion settings in Jellyfin/)
  assert.equal(jf.posts.length, 1)
  // …but a new plan (the card went) is applied.
  const cpu = await applyEncoding(jf.get, plan('none'), { last: first.applied!, planChanged: true })
  assert.ok(cpu.changed.includes('HardwareAccelerationType'))
  assert.equal(jf.cur().HardwareAccelerationType, 'none')
  assert.equal(jf.cur().EnableHardwareEncoding, false)
  assert.equal(jf.cur().EncoderPreset, 'slow')
})

test('the conversion cap: refuses only plays that need a conversion, and only at the cap', () => {
  const convert = JSON.stringify({ PlaySessionId: 'p', MediaSources: [{ Id: 'm', TranscodingUrl: '/videos/x/master.m3u8', SupportsDirectPlay: false, SupportsDirectStream: false }] })
  const direct = JSON.stringify({ PlaySessionId: 'p', MediaSources: [{ Id: 'm', TranscodingUrl: '/videos/x/master.m3u8', SupportsDirectPlay: true, SupportsDirectStream: true }] })
  assert.equal(capPlaybackInfo(convert, 1, 2), convert)
  assert.equal(capPlaybackInfo(direct, 5, 2), direct)
  const refused = JSON.parse(capPlaybackInfo(convert, 2, 2))
  assert.equal(refused.ErrorCode, 'RateLimitExceeded')
  assert.equal(refused.MediaSources[0].TranscodingUrl, undefined)
  assert.match(refused.FinesseMessage, /already converting 2 videos/)
  assert.equal(capPlaybackInfo('not json', 9, 1), 'not json')
  assert.equal(deviceOf('MediaBrowser Client="Finesse", Device="Chrome", DeviceId="abc-123", Version="1"'), 'abc-123')
})

test('apply: pins each app by UUID, changes nothing when the plan stands, and falls back when a card fails or vanishes', async () => {
  let probe = PROBE
  let failing = new Set<string>()
  const fd = await fakeDocker([], {
    run: (body) => {
      const cmd = (body.Cmd ?? []).join(' ')
      if (cmd.includes('/host/sys/class/drm')) return probe
      if (cmd.includes('h264_nvenc')) {
        const id = body.HostConfig.DeviceRequests[0].DeviceIDs[0]
        return failing.has(id) ? 'cuInit(0) failed -> CUDA_ERROR_NO_DEVICE: no CUDA-capable device is detected\nMEM 12288' : 'NVENC_OK\nMEM 12288'
      }
      return '/dev/dri\n/dev/nvidia0\n'
    },
  })
  const jfEnc = fakeEncoding({ HardwareAccelerationType: 'none', EncoderPreset: 'veryfast' })
  const jfServer = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const r = await jfEnc.get(req.url!, req.method === 'POST' ? { method: 'POST', body: JSON.parse(Buffer.concat(chunks).toString()) } : undefined)
    res.writeHead(r.status, { 'Content-Type': 'application/json' })
    res.end(r.json ? JSON.stringify(r.json) : '')
  })
  const jfUrl = await listen(jfServer)
  const dir = tmp()
  const settings = new SettingsStore({ configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'i.db'), bakedWeb: dir, updatedWeb: dir, previews: dir, backups: dir })
  settings.update((x) => {
    x.mode = 'bundle'
    x.jellyfin = { url: jfUrl, apiKey: 'k', basePath: '' }
    x.stack = { hostRoot: dir, hostData: join(dir, 'data'), timezone: 'UTC', puid: 1000, pgid: 1000, services: ['jellyfin', 'wolf'], streaming: { nvidia: true } }
  })
  const before = process.env.FINESSE_IN_DOCKER
  process.env.FINESSE_IN_DOCKER = '1'
  const docker = new Docker(fd.socket)
  ;(docker as unknown as { info: () => Promise<unknown> }).info = async () => ({ Runtimes: { nvidia: {} } })
  const orch = new Orchestrator(docker, 'mine')
  orch.waitReady = async () => {}
  const events: string[] = []
  const g = new GraphicsManager(settings, orch, (_l, m) => events.push(m))
  try {
    const first = await g.apply('test', { refresh: true })
    assert.equal(first!.plan.wolf.uuid, A)
    assert.equal(first!.plan.jellyfin.uuid, B)
    assert.deepEqual(fd.created['finesse-jellyfin'].HostConfig.DeviceRequests[0].DeviceIDs, [B])
    assert.deepEqual(fd.created['finesse-wolf'].HostConfig.DeviceRequests[0].DeviceIDs, [A])
    assert.equal(jfEnc.cur().HardwareAccelerationType, 'nvenc')
    assert.equal(jfEnc.cur().EncoderPreset, 'veryfast')
    assert.equal(jfEnc.posts.length, 1)

    // Nothing changed: no container touched, nothing posted.
    const appCalls = () => fd.calls.filter((c) => /finesse-(jellyfin|wolf)$/.test(c)).length
    const calls = appCalls()
    await g.apply('test', { refresh: true })
    assert.equal(appCalls(), calls)
    assert.equal(jfEnc.posts.length, 1)

    // The NAS's case: card A fails its test. Both apps move to B (shared while streaming).
    failing = new Set([A])
    const shared = await g.apply('test', { refresh: true })
    assert.equal(shared!.plan.wolf.uuid, B)
    assert.equal(shared!.plan.jellyfin.shared, true)
    assert.equal(shared!.plan.jellyfin.maxTranscodes, 2)
    assert.deepEqual(fd.created['finesse-wolf'].HostConfig.DeviceRequests[0].DeviceIDs, [B])
    assert.match(shared!.plan.notes.join(' '), /failed a test video conversion/)

    // Every card gone: back to the processor, nothing pinned, Jellyfin told.
    probe = ''
    const cpu = await g.apply('test', { refresh: true })
    assert.equal(cpu!.plan.jellyfin.accel, 'none')
    assert.equal(fd.created['finesse-jellyfin'].HostConfig.DeviceRequests, undefined)
    assert.equal(fd.created['finesse-wolf'].HostConfig.DeviceRequests, undefined)
    assert.equal(jfEnc.cur().HardwareAccelerationType, 'none')
    assert.ok(events.some((e) => /Jellyfin now uses the processor/.test(e)))
    // Only Finesse's own containers were ever made or changed.
    for (const body of Object.values(fd.created)) assert.equal(body.Labels['finesse.managed'], 'true')
  } finally {
    if (before === undefined) delete process.env.FINESSE_IN_DOCKER
    else process.env.FINESSE_IN_DOCKER = before
    jfServer.close()
    await fd.close()
  }
})
