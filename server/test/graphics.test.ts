// Graphics: finding the cards (the probe's output, each card's test conversion) and the plan of
// which card Jellyfin and game streaming use, across every kind of hardware.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Docker } from '../src/stack/docker.ts'
import { encodingFor, mergeEncoding, nvidiaDecode, nvidiaSessionLimit, planGraphics, planKey, type Gpu, type Inventory } from '../src/stack/graphics.ts'
import { parseProbe, probeGpus, testCard, testProblem } from '../src/stack/gpus.ts'
import { fakeDocker } from './fakeDocker.ts'

// The maintainer's NAS, as the probe saw it: two RTX 3060s.
const NAS_PROBE = `R renderD128 0x10de 0x2504 0000:01:00.0 nvidia -
R renderD129 0x10de 0x2503 0000:05:00.0 nvidia -
N
Model: 		 NVIDIA GeForce RTX 3060
IRQ:   		 162
GPU UUID: 	 GPU-51512123-c030-4d28-adb9-c56e13629c77
Bus Location: 	 0000:01:00.0
Device Minor: 	 0
N
Model: 		 NVIDIA GeForce RTX 3060
GPU UUID: 	 GPU-4284af6d-29d0-4237-5d61-3302caf483ff
Bus Location: 	 0000:05:00.0
`

const nv = (n: number, extra: Partial<Gpu> = {}): Gpu => ({
  id: `nvidia:GPU-${n}`,
  vendor: 'nvidia',
  name: 'NVIDIA GeForce RTX 3060',
  integrated: false,
  pci: `0000:0${n}:00.0`,
  renderNode: `/dev/dri/renderD${127 + n}`,
  uuid: `GPU-${n}`,
  vramMiB: 12288,
  encodes: true,
  sessionLimit: 8,
  decode: nvidiaDecode('NVIDIA GeForce RTX 3060'),
  ...extra,
})
const intel: Gpu = { id: 'dri:renderD128', vendor: 'intel', name: 'Intel graphics (built in)', integrated: true, pci: '0000:00:02.0', renderNode: '/dev/dri/renderD128', encodes: true, sessionLimit: null, decode: ['h264', 'hevc'] }
const amd: Gpu = { id: 'dri:renderD129', vendor: 'amd', name: 'AMD Radeon graphics card', integrated: false, pci: '0000:03:00.0', renderNode: '/dev/dri/renderD129', vramMiB: 16368, encodes: true, sessionLimit: null, decode: ['h264', 'hevc'] }
const inv = (gpus: Gpu[], nvidiaRuntime = true): Inventory => ({ checkedAt: '2026-11-01T00:00:00Z', gpus, nvidiaRuntime })

test('parseProbe: the NAS’s two RTX 3060s, by UUID, with their render nodes', () => {
  const g = parseProbe(NAS_PROBE)
  assert.equal(g.length, 2)
  assert.deepEqual(
    g.map((x) => [x.id, x.uuid, x.pci, x.renderNode, x.name, x.sessionLimit]),
    [
      ['nvidia:GPU-51512123-c030-4d28-adb9-c56e13629c77', 'GPU-51512123-c030-4d28-adb9-c56e13629c77', '0000:01:00.0', '/dev/dri/renderD128', 'NVIDIA GeForce RTX 3060', 8],
      ['nvidia:GPU-4284af6d-29d0-4237-5d61-3302caf483ff', 'GPU-4284af6d-29d0-4237-5d61-3302caf483ff', '0000:05:00.0', '/dev/dri/renderD129', 'NVIDIA GeForce RTX 3060', 8],
    ],
  )
  assert.ok(g[0]!.decode.includes('av1'))
  assert.equal(g[0]!.encodes, null)
})

test('parseProbe: Intel built-in plus an AMD card; an AMD APU counts as built in', () => {
  const g = parseProbe('R renderD128 0x8086 0x46a6 0000:00:02.0 i915 -\nR renderD129 0x1002 0x73bf 0000:03:00.0 amdgpu 17163091968\nR renderD130 0x1002 0x1638 0000:07:00.0 amdgpu 536870912\n')
  assert.deepEqual(
    g.map((x) => [x.id, x.vendor, x.integrated, x.vramMiB ?? null]),
    [
      // By PCI address: render node numbers can change between boots.
      ['dri:0000:00:02.0', 'intel', true, null],
      ['dri:0000:03:00.0', 'amd', false, 16368],
      ['dri:0000:07:00.0', 'amd', true, 512],
    ],
  )
  assert.deepEqual(g.map((x) => x.renderNode), ['/dev/dri/renderD128', '/dev/dri/renderD129', '/dev/dri/renderD130'])
  // Before its test decodes anything: H.264 only.
  assert.deepEqual(g[0]!.decode, ['h264'])
  assert.equal(parseProbe('').length, 0)
})

test('session limits and decoders by NVIDIA model', () => {
  assert.equal(nvidiaSessionLimit('NVIDIA GeForce RTX 3060'), 8)
  assert.equal(nvidiaSessionLimit('NVIDIA RTX A4000'), null)
  assert.equal(nvidiaSessionLimit('Quadro P2000'), null)
  assert.ok(nvidiaDecode('NVIDIA GeForce RTX 4070').includes('av1'))
  assert.ok(!nvidiaDecode('NVIDIA GeForce GTX 1660').includes('av1'))
  assert.ok(nvidiaDecode('NVIDIA GeForce GTX 1660').includes('vp9'))
  assert.deepEqual(nvidiaDecode('NVIDIA GeForce GTX 750'), ['h264', 'mpeg2video', 'vc1'])
})

test('plan: no card — CPU, one conversion at a time, clips at night, no game streaming', () => {
  const p = planGraphics(inv([]), { streaming: true })
  assert.equal(p.jellyfin.gpu, null)
  assert.equal(p.jellyfin.accel, 'none')
  assert.equal(p.jellyfin.maxTranscodes, 1)
  assert.equal(p.clipsNightOnly, true)
  assert.equal(p.wolf.gpu, null)
  assert.match(p.wolf.why, /needs a graphics card, and this server has none/)
})

test('plan: one card — shared, games first, Jellyfin capped only while streaming is on', () => {
  const on = planGraphics(inv([nv(1)]), { streaming: true })
  assert.equal(on.jellyfin.gpu, 'nvidia:GPU-1')
  assert.equal(on.wolf.gpu, 'nvidia:GPU-1')
  assert.equal(on.jellyfin.shared, true)
  assert.equal(on.jellyfin.maxTranscodes, 2)
  assert.equal(on.jellyfin.accel, 'nvenc')
  assert.equal(on.jellyfin.uuid, 'GPU-1')
  const off = planGraphics(inv([nv(1)]), { streaming: false })
  assert.equal(off.jellyfin.shared, false)
  assert.equal(off.jellyfin.maxTranscodes, 8)
  // Same card either way: turning streaming on or off never moves Jellyfin.
  assert.equal(planKey(on), planKey(off))
  // An Intel chip alone: Quick Sync on its render node, no limit of its own.
  const i = planGraphics(inv([intel]), { streaming: false })
  assert.equal(i.jellyfin.accel, 'qsv')
  assert.equal(i.jellyfin.renderNode, '/dev/dri/renderD128')
  assert.equal(i.jellyfin.maxTranscodes, null)
  assert.equal(i.clipsNightOnly, false)
})

test('plan: built-in chip plus a card — Jellyfin on the chip, Wolf on the card', () => {
  const p = planGraphics(inv([nv(1), intel]), { streaming: true })
  assert.equal(p.jellyfin.gpu, intel.id)
  assert.equal(p.jellyfin.accel, 'qsv')
  assert.equal(p.wolf.gpu, 'nvidia:GPU-1')
  assert.equal(p.jellyfin.shared, false)
  const amdChip = { ...amd, id: 'dri:renderD130', renderNode: '/dev/dri/renderD130', name: 'AMD graphics (built in)', integrated: true, vramMiB: 512 }
  const q = planGraphics(inv([amdChip, nv(1)]), { streaming: false })
  assert.equal(q.jellyfin.accel, 'vaapi')
  assert.equal(q.jellyfin.renderNode, '/dev/dri/renderD130')
})

test('plan: two or more cards — Wolf on the strongest, Jellyfin on another', () => {
  const small = nv(2, { name: 'NVIDIA GeForce GTX 1660', vramMiB: 6144, decode: nvidiaDecode('NVIDIA GeForce GTX 1660') })
  const p = planGraphics(inv([small, nv(1)]), { streaming: true })
  assert.equal(p.wolf.gpu, 'nvidia:GPU-1')
  assert.equal(p.jellyfin.gpu, 'nvidia:GPU-2')
  assert.equal(p.jellyfin.maxTranscodes, 8)
  // NVIDIA and AMD cards: NVIDIA for Wolf, AMD (VA-API) for Jellyfin.
  const m = planGraphics(inv([amd, nv(1)]), { streaming: true })
  assert.equal(m.wolf.gpu, 'nvidia:GPU-1')
  assert.equal(m.jellyfin.accel, 'vaapi')
  // Two identical cards: the first by PCI order for Wolf.
  const two = planGraphics(inv([nv(5), nv(1)]), { streaming: false })
  assert.equal(two.wolf.gpu, 'nvidia:GPU-1')
  assert.equal(two.jellyfin.gpu, 'nvidia:GPU-5')
})

test('plan: the NAS — one 3060 fails its test, so both use the other (shared while streaming)', () => {
  const p = planGraphics(inv([nv(1, { encodes: false, problem: 'no CUDA-capable device is detected' }), nv(5)]), { streaming: true })
  assert.equal(p.jellyfin.gpu, 'nvidia:GPU-5')
  assert.equal(p.wolf.gpu, 'nvidia:GPU-5')
  assert.equal(p.jellyfin.shared, true)
  assert.match(p.notes.join(' '), /01:00\.0\) failed a test video conversion \(no CUDA-capable device is detected\)/)
})

test('plan: NVIDIA without its container toolkit, and a card that vanished', () => {
  const p = planGraphics(inv([nv(1)], false), { streaming: true })
  assert.equal(p.jellyfin.accel, 'none')
  assert.equal(p.wolf.gpu, null)
  assert.match(p.notes[0]!, /NVIDIA Container Toolkit/)
  // Planned on two cards; one gone: nothing still points at it, and a lone card is shared.
  const before = planGraphics(inv([nv(1), nv(5)]), { streaming: true })
  const after = planGraphics(inv([nv(5)]), { streaming: true })
  assert.notEqual(planKey(before), planKey(after))
  assert.ok(![after.jellyfin.gpu, after.wolf.gpu].includes('nvidia:GPU-1'))
  // Every card gone: back to the CPU, nothing pinned.
  const none = planGraphics(inv([]), { streaming: true })
  assert.equal(none.jellyfin.uuid, undefined)
  assert.equal(none.wolf.uuid, undefined)
})

test('plan: an administrator’s choice wins while the card is there and working', () => {
  const p = planGraphics(inv([nv(1), nv(5)]), { streaming: true, override: { jellyfin: 'nvidia:GPU-1', wolf: 'nvidia:GPU-1' } })
  assert.equal(p.jellyfin.gpu, 'nvidia:GPU-1')
  assert.equal(p.wolf.gpu, 'nvidia:GPU-1')
  assert.equal(p.jellyfin.shared, true)
  assert.match(p.jellyfin.why, /as an administrator chose/)
  const cpu = planGraphics(inv([nv(1)]), { streaming: false, override: { jellyfin: 'cpu' } })
  assert.equal(cpu.jellyfin.accel, 'none')
  assert.equal(cpu.wolf.gpu, 'nvidia:GPU-1')
  const gone = planGraphics(inv([nv(5)]), { streaming: false, override: { jellyfin: 'nvidia:GPU-1' } })
  assert.equal(gone.jellyfin.gpu, 'nvidia:GPU-5')
  assert.match(gone.notes.join(' '), /isn’t here any more/)
  const broken = planGraphics(inv([nv(1, { encodes: false }), nv(5)]), { streaming: false, override: { wolf: 'nvidia:GPU-1' } })
  assert.equal(broken.wolf.gpu, 'nvidia:GPU-5')
  assert.match(broken.notes.join(' '), /can’t be used right now/)
})

test('encoding settings: what each card sets, merged without touching anything else', () => {
  const p = planGraphics(inv([nv(5)]), { streaming: false })
  const want = encodingFor(p.jellyfin)
  assert.deepEqual(want, {
    HardwareAccelerationType: 'nvenc',
    EnableHardwareEncoding: true,
    HardwareDecodingCodecs: nvidiaDecode('NVIDIA GeForce RTX 3060').filter((c) => !c.endsWith('-10bit')),
    EnableDecodingColorDepth10Hevc: true,
    EnableDecodingColorDepth10Vp9: true,
    EnableTonemapping: true,
  })
  const current = { HardwareAccelerationType: 'none', EncoderPreset: 'slow', H264Crf: 21, TranscodingTempPath: '/cache/transcodes', HardwareDecodingCodecs: ['h264'], EnableTonemapping: true }
  const m = mergeEncoding(current, want)
  assert.equal(m.next.EncoderPreset, 'slow')
  assert.equal(m.next.H264Crf, 21)
  assert.equal(m.next.TranscodingTempPath, '/cache/transcodes')
  assert.deepEqual(m.changed.sort(), ['EnableDecodingColorDepth10Hevc', 'EnableDecodingColorDepth10Vp9', 'EnableHardwareEncoding', 'HardwareAccelerationType', 'HardwareDecodingCodecs'])
  // Applying again changes nothing.
  assert.deepEqual(mergeEncoding(m.next, want).changed, [])
  assert.deepEqual(encodingFor({ accel: 'vaapi', decode: ['h264'], renderNode: '/dev/dri/renderD129' }).VaapiDevice, '/dev/dri/renderD129')
  assert.deepEqual(encodingFor({ accel: 'qsv', decode: ['h264'], renderNode: '/dev/dri/renderD128' }).QsvDevice, '/dev/dri/renderD128')
  assert.deepEqual(encodingFor({ accel: 'none', decode: [] }), { HardwareAccelerationType: 'none', EnableHardwareEncoding: false, HardwareDecodingCodecs: [], EnableThrottling: true })
})

test('testProblem: the useful line of a failed test', () => {
  assert.equal(testProblem('[h264_nvenc @ 0x1] dl_fn->cuda_dl->cuInit(0) failed -> CUDA_ERROR_NO_DEVICE: no CUDA-capable device is detected\n[vost#0:0] Task finished'), 'dl_fn->cuda_dl->cuInit(0) failed -> CUDA_ERROR_NO_DEVICE: no CUDA-capable device is detected')
  assert.equal(testProblem(''), 'no answer')
})

test('each card is tested alone, pinned by UUID or render node; a failed test is recorded', async () => {
  const fd = await fakeDocker([], {
    run: (body) => {
      const cmd = (body.Cmd ?? []).join(' ')
      if (cmd.includes('/host/sys/class/drm')) return NAS_PROBE
      const ids = body.HostConfig?.DeviceRequests?.[0]?.DeviceIDs ?? []
      if (ids.includes('GPU-51512123-c030-4d28-adb9-c56e13629c77')) return '[h264_nvenc @ 0x5] OpenEncodeSessionEx failed: unsupported device (2): (no details)\nMEM 12288\n'
      return 'NVENC_OK\nMEM 12288\n'
    },
  })
  try {
    const docker = new Docker(fd.socket)
    const fake = docker as unknown as { info: () => Promise<unknown> }
    fake.info = async () => ({ Runtimes: { runc: {}, nvidia: {} } })
    const got = await probeGpus(docker, { probeImage: 'ghcr.io/coffeecc/finesse:3.2.6', testImage: 'jellyfin/jellyfin:10.11.11', inDocker: true })
    assert.equal(got.nvidiaRuntime, true)
    assert.deepEqual(
      got.gpus.map((g) => [g.uuid, g.encodes, g.vramMiB]),
      [
        ['GPU-51512123-c030-4d28-adb9-c56e13629c77', false, 12288],
        ['GPU-4284af6d-29d0-4237-5d61-3302caf483ff', true, 12288],
      ],
    )
    assert.match(got.gpus[0]!.problem!, /unsupported device/)
    const tests = Object.entries(fd.created).filter(([n]) => n.startsWith('finesse-gpu-test-'))
    assert.equal(tests.length, 2)
    for (const [, body] of tests) {
      assert.equal(body.Labels['finesse.managed'], 'true')
      assert.equal(body.HostConfig.DeviceRequests[0].DeviceIDs.length, 1)
      assert.ok(!JSON.stringify(body).includes('"all"'))
    }
    // The probe only reads the host: /sys and NVIDIA's /proc entry, read-only.
    const probe = Object.values(fd.created).find((b) => (b.Cmd ?? []).join(' ').includes('/host/sys/class/drm'))
    assert.deepEqual(probe.HostConfig.Binds, ['/sys:/host/sys:ro', '/proc/driver/nvidia:/host/nvidia:ro'])
    // Intel: tested on its own render node.
    const r = await testCard(docker, 'jellyfin/jellyfin:10.11.11', intel)
    assert.equal(r.encodes, false)
    const last = Object.values(fd.created).pop()
    assert.deepEqual(last.HostConfig.Devices, [{ PathOnHost: '/dev/dri/renderD128', PathInContainer: '/dev/dri/renderD128', CgroupPermissions: 'rwm' }])
  } finally {
    await fd.close()
  }
})
