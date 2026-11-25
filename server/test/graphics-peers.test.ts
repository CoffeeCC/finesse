// A card whose driver only converts video when the container can see the other NVIDIA cards
// too (seen on a 3060 + 3070 NAS: the second card alone says "unsupported device"). Finesse
// finds that in its test, gives the apps the other cards as well, and keeps video on the card.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visibleTo, canSee } from '../src/graphicsHealth.ts'
import { CATALOG, type StackContext } from '../src/stack/catalog.ts'
import { Docker } from '../src/stack/docker.ts'
import { assignKey, nvidiaDecode, planGraphics, settleInventory, type Gpu, type Inventory } from '../src/stack/graphics.ts'
import { probeGpus } from '../src/stack/gpus.ts'
import { containerSpec } from '../src/stack/orchestrator.ts'
import { fakeDocker } from './fakeDocker.ts'

const A = 'GPU-51512123-c030-4d28-adb9-c56e13629c77'
const C = 'GPU-874bfc9d-2abc-6b4d-d381-b8cd22ac0eee'
const PROBE = `R renderD128 0x10de 0x2504 0000:01:00.0 nvidia -
R renderD129 0x10de 0x2484 0000:05:00.0 nvidia -
N
Model: NVIDIA GeForce RTX 3060
GPU UUID: ${A}
Bus Location: 0000:01:00.0
N
Model: NVIDIA GeForce RTX 3070
GPU UUID: ${C}
Bus Location: 0000:05:00.0
`
const card = (uuid: string, name: string, pci: string, extra: Partial<Gpu> = {}): Gpu => ({ id: `nvidia:${uuid}`, vendor: 'nvidia', name, integrated: false, pci, uuid, vramMiB: 8192, encodes: true, sessionLimit: 8, decode: nvidiaDecode(name), ...extra })

test('a card that only encodes beside the others is found, and records them as peers', async () => {
  const fd = await fakeDocker([], {
    run: (body) => {
      const cmd = (body.Cmd ?? []).join(' ')
      if (cmd.includes('/host/sys/class/drm')) return PROBE
      const ids: string[] = body.HostConfig?.DeviceRequests?.[0]?.DeviceIDs ?? []
      // The 3070 alone can't open an encoder; with the 3060 there too, it can.
      if (ids.length === 1 && ids[0] === C) return '[h264_nvenc @ 0x5] OpenEncodeSessionEx failed: unsupported device (2): (no details)\nMEM 8192\n'
      return `NVENC_OK\nMEM ${ids[0] === C ? 8192 : 12288}\n`
    },
  })
  try {
    const docker = new Docker(fd.socket)
    ;(docker as unknown as { info: () => Promise<unknown> }).info = async () => ({ Runtimes: { runc: {}, nvidia: {} } })
    const got = await probeGpus(docker, { probeImage: 'ghcr.io/coffeecc/finesse:3.2.8', testImage: 'jellyfin/jellyfin:10.11.11', inDocker: true })
    assert.deepEqual(
      got.gpus.map((g) => [g.uuid, g.encodes, g.peers ?? null, g.vramMiB]),
      [
        [A, true, null, 12288],
        [C, true, [A], 8192],
      ],
    )
    // Only the card that failed alone was tried again, and its retry kept video on it.
    const tests = Object.values(fd.created).filter((b: any) => !(b.Cmd ?? []).join(' ').includes('/host/sys/class/drm')) as any[]
    assert.equal(tests.length, 3)
    const retry = tests[2]
    assert.deepEqual(retry.HostConfig.DeviceRequests[0].DeviceIDs, [C, A])
    assert.ok(retry.Env.includes(`NVIDIA_VISIBLE_DEVICES=${C},${A}`))
    assert.ok(retry.Env.includes(`CUDA_VISIBLE_DEVICES=${C}`))
    assert.match(retry.Cmd.join(' '), new RegExp(`nvidia-smi -i ${C} `))
  } finally {
    await fd.close()
  }
})

test('a card that fails with the others too stays failed, with no peers', async () => {
  const fd = await fakeDocker([], {
    run: (body) => {
      const cmd = (body.Cmd ?? []).join(' ')
      if (cmd.includes('/host/sys/class/drm')) return PROBE
      const ids: string[] = body.HostConfig?.DeviceRequests?.[0]?.DeviceIDs ?? []
      return ids[0] === C ? 'OpenEncodeSessionEx failed: unsupported device (2)\n' : 'NVENC_OK\n'
    },
  })
  try {
    const docker = new Docker(fd.socket)
    ;(docker as unknown as { info: () => Promise<unknown> }).info = async () => ({ Runtimes: { runc: {}, nvidia: {} } })
    const got = await probeGpus(docker, { probeImage: 'ghcr.io/coffeecc/finesse:3.2.8', testImage: 'jellyfin/jellyfin:10.11.11', inDocker: true })
    const c = got.gpus.find((g) => g.uuid === C)!
    assert.equal(c.encodes, false)
    assert.equal(c.peers, undefined)
    assert.match(c.problem!, /unsupported device/)
  } finally {
    await fd.close()
  }
})

test('the plan, the key and the containers carry the peers; without peers nothing changes', () => {
  const inv: Inventory = { checkedAt: 't', nvidiaRuntime: true, gpus: [card(A, 'NVIDIA GeForce RTX 3060', '0000:01:00.0', { vramMiB: 12288 }), card(C, 'NVIDIA GeForce RTX 3070', '0000:05:00.0', { peers: [A] })] }
  const plan = planGraphics(inv, { streaming: true })
  // The 3060 has more memory: games get it, Jellyfin gets the 3070, with the 3060 beside it.
  assert.equal(plan.wolf.uuid, A)
  assert.equal(plan.wolf.peers, undefined)
  assert.equal(plan.jellyfin.uuid, C)
  assert.deepEqual(plan.jellyfin.peers, [A])
  assert.match(plan.jellyfin.why, /other NVIDIA card too/)
  // An administrator puts games on the 3070: Wolf gets the 3060 beside it as well.
  const chosen = planGraphics(inv, { streaming: true, override: { wolf: `nvidia:${C}`, jellyfin: `nvidia:${A}` } })
  assert.equal(chosen.jellyfin.uuid, A)
  assert.deepEqual(chosen.wolf.peers, [A])

  // Keys: unchanged for an assignment without peers (no container is recreated by this release).
  assert.equal(assignKey({ gpu: `nvidia:${A}`, accel: 'nvenc', uuid: A, renderNode: '/dev/dri/renderD128' }), `nvidia:${A},nvenc,${A},/dev/dri/renderD128`)
  assert.notEqual(assignKey(plan.jellyfin), assignKey({ ...plan.jellyfin, peers: undefined }))

  const ctx: StackContext = {
    hostRoot: '/srv/finesse', hostData: '/srv/finesse/data', puid: 1000, pgid: 1000, timezone: 'UTC', network: 'finesse',
    exposeJellyfin: false, jellyfinPort: 8096, gpu: true, gpuGroups: ['107'], hostDevices: ['/dev/dri', '/dev/nvidia0'], streaming: { nvidia: true },
    graphics: { jellyfin: plan.jellyfin, wolf: chosen.wolf },
  }
  const jf = containerSpec(CATALOG.jellyfin, ctx) as any
  assert.deepEqual(jf.HostConfig.DeviceRequests, [{ Driver: 'nvidia', DeviceIDs: [C, A], Capabilities: [['gpu']] }])
  assert.ok(jf.Env.includes(`NVIDIA_VISIBLE_DEVICES=${C},${A}`))
  assert.ok(jf.Env.includes(`CUDA_VISIBLE_DEVICES=${C}`))
  const wolf = containerSpec(CATALOG.wolf, ctx) as any
  assert.deepEqual(wolf.HostConfig.DeviceRequests[0].DeviceIDs, [C, A])
  assert.ok(wolf.Env.includes(`CUDA_VISIBLE_DEVICES=${C}`))
  // Without peers: one card, no CUDA pin, as before.
  const plain = containerSpec(CATALOG.jellyfin, { ...ctx, graphics: { jellyfin: chosen.jellyfin, wolf: plan.wolf } }) as any
  assert.deepEqual(plain.HostConfig.DeviceRequests[0].DeviceIDs, [A])
  assert.ok(!plain.Env.some((e: string) => e.startsWith('CUDA_VISIBLE_DEVICES=')))
})

test('peers are kept when a test could not run, and when an in-use card is kept after a failure', () => {
  const before: Inventory = { checkedAt: '1', nvidiaRuntime: true, gpus: [card(C, 'NVIDIA GeForce RTX 3070', '0000:05:00.0', { peers: [A] })] }
  const untested: Inventory = { checkedAt: '2', nvidiaRuntime: true, gpus: [card(C, 'NVIDIA GeForce RTX 3070', '0000:05:00.0', { encodes: null })] }
  assert.deepEqual(settleInventory(untested, { inventory: before, inUse: [] }, true).inv.gpus[0]!.peers, [A])
  const failed: Inventory = { checkedAt: '3', nvidiaRuntime: true, gpus: [card(C, 'NVIDIA GeForce RTX 3070', '0000:05:00.0', { encodes: false, problem: 'x' })] }
  const kept = settleInventory(failed, { inventory: before, inUse: [{ gpu: `nvidia:${C}`, uuid: C }] }, true).inv.gpus[0]!
  assert.equal(kept.encodes, true)
  assert.deepEqual(kept.peers, [A])
})

test('adopt: a Jellyfin given both cards but pinned to one by CUDA_VISIBLE_DEVICES uses that one', () => {
  const inv: Inventory = { checkedAt: 't', nvidiaRuntime: true, gpus: [card(A, 'NVIDIA GeForce RTX 3060', '0000:01:00.0'), card(C, 'NVIDIA GeForce RTX 3070', '0000:05:00.0')] }
  // What the TrueNAS app looks like with "use all GPUs" and the variable added.
  const v = visibleTo({ HostConfig: { Runtime: 'nvidia', DeviceRequests: [{ Driver: 'nvidia', Count: 0, DeviceIDs: [A, C], Capabilities: [['gpu']] }] }, Config: { Image: 'jellyfin/jellyfin', Env: [`NVIDIA_VISIBLE_DEVICES=${A},${C}`, `CUDA_VISIBLE_DEVICES=${C}`], Labels: {} }, Mounts: [] } as any)
  assert.deepEqual(v.uuids, [C])
  assert.ok(canSee(v, inv.gpus[1]!, inv))
  assert.ok(!canSee(v, inv.gpus[0]!, inv))
  // `--gpus all` with the pin.
  const all = visibleTo({ HostConfig: { DeviceRequests: [{ Driver: '', Count: -1, Capabilities: [['gpu']] }] }, Config: { Image: 'j', Env: [`CUDA_VISIBLE_DEVICES=${C}`], Labels: {} }, Mounts: [] } as any)
  assert.equal(all.nvidiaAll, false)
  assert.deepEqual(all.uuids, [C])
})
