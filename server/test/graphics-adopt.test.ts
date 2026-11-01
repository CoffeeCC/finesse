// Someone's own Jellyfin (adopt): which cards its container was given (looked at, never changed),
// the Connected-apps finding about its video conversion, and the one-click fix through its API.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { SettingsStore } from '../src/config.ts'
import { canSee, fixCard, jellyfinGraphicsCheck, visibleTo } from '../src/graphicsHealth.ts'
import { Docker } from '../src/stack/docker.ts'
import { nvidiaDecode, type Gpu, type Inventory } from '../src/stack/graphics.ts'
import { GraphicsManager } from '../src/stack/graphicsManager.ts'
import { Orchestrator } from '../src/stack/orchestrator.ts'
import { fakeDocker } from './fakeDocker.ts'
import { listen, tmp } from './helpers.ts'

const A = 'GPU-51512123-c030-4d28-adb9-c56e13629c77'
const B = 'GPU-4284af6d-29d0-4237-5d61-3302caf483ff'
const card = (uuid: string, pci: string, extra: Partial<Gpu> = {}): Gpu => ({ id: `nvidia:${uuid}`, vendor: 'nvidia', name: 'NVIDIA GeForce RTX 3060', integrated: false, pci, uuid, renderNode: '/dev/dri/renderD128', vramMiB: 12288, encodes: true, sessionLimit: 8, decode: nvidiaDecode('NVIDIA GeForce RTX 3060'), ...extra })
// The NAS: card A fails test conversions from containers, B works.
const nas: Inventory = { checkedAt: '', nvidiaRuntime: true, gpus: [card(A, '0000:01:00.0', { encodes: false, problem: 'no CUDA-capable device is detected' }), card(B, '0000:05:00.0', { renderNode: '/dev/dri/renderD129' })] }

const inspect = (hc: Record<string, unknown>, env: string[] = [], mounts: { Source: string; Destination: string }[] = []) => ({ HostConfig: hc, Config: { Image: 'jellyfin/jellyfin', Env: env, Labels: {} }, Mounts: mounts })

test('visibleTo: the ways a container is given cards', () => {
  // TrueNAS apps: a device request by UUID, and the variable that says the same.
  const truenas = visibleTo(inspect({ Runtime: 'nvidia', DeviceRequests: [{ Driver: 'nvidia', Count: 0, DeviceIDs: [B], Capabilities: [['gpu']] }] }, [`NVIDIA_VISIBLE_DEVICES=${B}`]))
  assert.deepEqual(truenas, { nvidiaAll: false, uuids: [B], indexes: [], driAll: false, nodes: [] })
  // `--gpus all`
  assert.equal(visibleTo(inspect({ DeviceRequests: [{ Driver: '', Count: -1, Capabilities: [['gpu']] }] })).nvidiaAll, true)
  // The old runtime way: NVIDIA_VISIBLE_DEVICES with runtime nvidia, by index.
  const byIndex = visibleTo(inspect({ Runtime: 'nvidia' }, ['NVIDIA_VISIBLE_DEVICES=1']))
  assert.deepEqual(byIndex.indexes, [1])
  assert.ok(canSee(byIndex, nas.gpus[1]!, nas))
  assert.ok(!canSee(byIndex, nas.gpus[0]!, nas))
  // The variable alone, without the runtime or a request, gives nothing.
  assert.equal(visibleTo(inspect({}, ['NVIDIA_VISIBLE_DEVICES=all'])).nvidiaAll, false)
  // Intel/AMD: /dev/dri, or one node, or a bind of /dev.
  assert.equal(visibleTo(inspect({ Devices: [{ PathOnHost: '/dev/dri', PathInContainer: '/dev/dri' }] })).driAll, true)
  assert.deepEqual(visibleTo(inspect({ Devices: [{ PathOnHost: '/dev/dri/renderD128' }] })).nodes, ['/dev/dri/renderD128'])
  assert.equal(visibleTo(inspect({ Binds: ['/dev/dri:/dev/dri'] })).driAll, true)
})

test('finding: on the CPU beside a card its container can use — one click', () => {
  const v = visibleTo(inspect({ DeviceRequests: [{ Driver: 'nvidia', DeviceIDs: [B] }] }))
  const c = jellyfinGraphicsCheck(nas, v, { HardwareAccelerationType: 'none' }, 'ix-jellyfin-jellyfin-1')!
  assert.equal(c.ok, null)
  assert.equal(c.summary, 'Jellyfin converts video on the CPU, but this server has an NVIDIA GeForce RTX 3060.')
  assert.deepEqual(c.fix, { label: 'Use the RTX 3060', gpu: `nvidia:${B}` })
  assert.match(c.problems[0]!, /can already use NVIDIA GeForce RTX 3060 \(05:00\.0\)/)
})

test('finding: on the CPU, and the container was only given the broken card — says what to do instead', () => {
  const v = visibleTo(inspect({ DeviceRequests: [{ Driver: 'nvidia', DeviceIDs: [A] }] }))
  assert.equal(fixCard(nas, v), null)
  const c = jellyfinGraphicsCheck(nas, v, { HardwareAccelerationType: '' }, 'jf')!
  assert.equal(c.fix, undefined)
  assert.match(c.problems[0]!, /can’t use the card yet.*Apps → Jellyfin → Edit → GPU Configuration, GPU-4284af6d/)
})

test('finding: set to NVENC on the card that fails (the NAS before the move) — not working, use the other one', () => {
  const v = visibleTo(inspect({ DeviceRequests: [{ Driver: 'nvidia', DeviceIDs: [A] }] }))
  const c = jellyfinGraphicsCheck(nas, v, { HardwareAccelerationType: 'nvenc' }, 'jf')!
  assert.equal(c.ok, false)
  assert.match(c.summary, /01:00\.0\), but it failed a test conversion/)
  assert.match(c.problems[0]!, /no CUDA-capable device is detected.*\(05:00\.0\) instead/)
})

test('finding: set to NVENC on the working card (the NAS now) — fine; no card at all — nothing to say', () => {
  const v = visibleTo(inspect({ DeviceRequests: [{ Driver: 'nvidia', DeviceIDs: [B] }] }))
  const c = jellyfinGraphicsCheck(nas, v, { HardwareAccelerationType: 'nvenc' }, 'jf')!
  assert.equal(c.ok, true)
  assert.equal(c.summary, 'Converts video on NVIDIA GeForce RTX 3060 (05:00.0).')
  assert.equal(jellyfinGraphicsCheck({ checkedAt: '', gpus: [], nvidiaRuntime: false }, v, { HardwareAccelerationType: 'none' }, 'jf'), null)
})

test('the one-click fix sets only Jellyfin’s video settings, for the card its container already has; the container is never touched', async () => {
  const fd = await fakeDocker(
    [
      { id: 'jf', name: 'ix-jellyfin-jellyfin-1', image: 'jellyfin/jellyfin:10.11.11', ports: { '8096/tcp': '8096' }, deviceRequests: [{ Driver: 'nvidia', Count: 0, DeviceIDs: [B], Capabilities: [['gpu']] }], env: [`NVIDIA_VISIBLE_DEVICES=${B}`] },
    ],
    {
      run: (body) => {
        const cmd = (body.Cmd ?? []).join(' ')
        if (cmd.includes('/host/sys/class/drm')) return `R renderD128 0x10de 0x2504 0000:01:00.0 nvidia -\nR renderD129 0x10de 0x2503 0000:05:00.0 nvidia -\nN\nModel: NVIDIA GeForce RTX 3060\nGPU UUID: ${A}\nBus Location: 0000:01:00.0\nN\nModel: NVIDIA GeForce RTX 3060\nGPU UUID: ${B}\nBus Location: 0000:05:00.0\n`
        if (cmd.includes('h264_nvenc')) return body.HostConfig.DeviceRequests[0].DeviceIDs[0] === A ? 'unsupported device' : 'NVENC_OK'
        return ''
      },
    },
  )
  let enc: Record<string, unknown> = { HardwareAccelerationType: 'none', EncoderPreset: 'slow', H264Crf: 23 }
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
  const url = await listen(jf)
  const dir = tmp()
  const settings = new SettingsStore({ configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'i.db'), bakedWeb: dir, updatedWeb: dir, previews: dir, backups: dir })
  settings.update((x) => {
    x.mode = 'adopt'
    x.jellyfin = { url, apiKey: 'k', basePath: '' }
    x.existing = { connectedAt: '', apps: { jellyfin: { where: 'docker', container: 'ix-jellyfin-jellyfin-1' } } }
  })
  const before = process.env.FINESSE_IN_DOCKER
  process.env.FINESSE_IN_DOCKER = '1'
  const docker = new Docker(fd.socket)
  ;(docker as unknown as { info: () => Promise<unknown> }).info = async () => ({ Runtimes: { nvidia: {} } })
  const g = new GraphicsManager(settings, new Orchestrator(docker, 'mine'))
  try {
    const a = await g.adoptCheck(true)
    assert.equal(a.check?.fix?.gpu, `nvidia:${B}`)
    // A card the container can't use is refused.
    await assert.rejects(g.adoptFix(`nvidia:${A}`), /can’t use that card/)
    assert.equal(await g.adoptFix(`nvidia:${B}`), 'NVIDIA GeForce RTX 3060')
    assert.equal(posts.length, 1)
    assert.equal(enc.HardwareAccelerationType, 'nvenc')
    assert.equal(enc.EnableHardwareEncoding, true)
    assert.equal(enc.EncoderPreset, 'slow')
    assert.equal(enc.H264Crf, 23)
    // Jellyfin's container: inspected, never started, stopped, created or removed.
    assert.ok(!fd.calls.some((c) => /(^| )(jf|ix-jellyfin-jellyfin-1)$/.test(c)), fd.calls.join('\n'))
    const after = await g.adoptCheck(true)
    assert.equal(after.check?.ok, true)
  } finally {
    if (before === undefined) delete process.env.FINESSE_IN_DOCKER
    else process.env.FINESSE_IN_DOCKER = before
    jf.close()
    await fd.close()
  }
})
