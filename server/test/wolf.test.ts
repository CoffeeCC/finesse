// Game streaming on a managed install: Wolf's container, and the readiness
// check Settings → Server shows before turning it on.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATALOG, wolfSocket, type StackContext } from '../src/stack/catalog.ts'
import { containerSpec, specHash } from '../src/stack/orchestrator.ts'
import { streamingCheck, wolfFolderProblem } from '../src/stack/wolf.ts'

const ctx = (extra: Partial<StackContext> = {}): StackContext => ({
  hostRoot: '/mnt/tank/finesse',
  hostData: '/mnt/tank/media',
  puid: 568,
  pgid: 568,
  timezone: 'Europe/London',
  network: 'finesse',
  exposeJellyfin: true,
  jellyfinPort: 8096,
  gpu: true,
  hostDevices: ['/dev/dri', '/dev/uinput', '/dev/uhid'],
  ...extra,
})

const RUN = { runDir: '/mnt/tank/finesse/config/wolf/run' }

type Spec = { Env: string[]; HostConfig: Record<string, unknown>; NetworkingConfig?: unknown }

test('Wolf: host network, its devices, the input rule, and same-path folders', () => {
  const spec = containerSpec(CATALOG.wolf, ctx()) as Spec
  const hc = spec.HostConfig
  assert.equal(hc.NetworkMode, 'host')
  assert.equal(spec.NetworkingConfig, undefined, 'no network aliases on the host network')
  assert.deepEqual(hc.DeviceCgroupRules, ['c 13:* rmw'])
  assert.deepEqual((hc.Devices as { PathOnHost: string }[]).map((d) => d.PathOnHost), ['/dev/dri', '/dev/uinput', '/dev/uhid'])
  const dir = '/mnt/tank/finesse/config/wolf'
  assert.ok((hc.Binds as string[]).includes(`${dir}:${dir}`))
  assert.ok((hc.Binds as string[]).includes(`${dir}/run:${dir}/run`), 'Wolf finds its socket folder only as a mount of its own')
  assert.ok((hc.Binds as string[]).includes('/var/run/docker.sock:/var/run/docker.sock'))
  const env = Object.fromEntries(spec.Env.map((e) => e.split(/=(.*)/s).slice(0, 2)))
  assert.equal(env.WOLF_SOCKET_PATH, wolfSocket(ctx()))
  assert.equal(env.WOLF_SOCKET_PATH, `${dir}/run/wolf.sock`, 'inside Finesse’s config folder, which Finesse sees at the same path')
  assert.equal(env.HOST_APPS_STATE_FOLDER, dir)
  assert.equal(env.XDG_RUNTIME_DIR, `${dir}/run`)
  assert.equal(env.WOLF_CFG_FILE, `${dir}/cfg/config.toml`)
  assert.equal(env.WOLF_DEFAULT_RUN_UID, '568')
  assert.equal(env.NVIDIA_VISIBLE_DEVICES, undefined)
  assert.equal(hc.DeviceRequests, undefined)
})

test('Wolf: only the devices this machine has, and the Nvidia card when Docker can hand it over', () => {
  const bare = containerSpec(CATALOG.wolf, ctx({ hostDevices: [], gpu: false })) as Spec
  assert.deepEqual(bare.HostConfig.Devices, [])
  const nv = containerSpec(CATALOG.wolf, ctx({ hostDevices: ['/dev/dri', '/dev/nvidia0', '/dev/uinput'], streaming: { nvidia: true } })) as Spec
  assert.deepEqual(nv.HostConfig.DeviceRequests, [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }])
  assert.ok(nv.Env.includes('NVIDIA_DRIVER_CAPABILITIES=all'))
})

test('no other app’s container changes (their spec hash stays the same)', () => {
  for (const def of Object.values(CATALOG)) {
    if (def.id === 'wolf') continue
    const hc = (containerSpec(def, ctx()) as Spec).HostConfig
    assert.equal('DeviceCgroupRules' in hc, false, def.id)
    assert.equal('DeviceRequests' in hc, false, def.id)
    assert.notEqual(hc.NetworkMode, 'host', def.id)
  }
  // A known value: Jellyfin's spec is untouched by streaming settings.
  assert.equal(specHash(containerSpec(CATALOG.jellyfin, ctx())), specHash(containerSpec(CATALOG.jellyfin, ctx({ streaming: { nvidia: true } }))))
})

test('readiness: an Intel/AMD box with everything is all good', () => {
  const c = streamingCheck({ devices: ['/dev/dri', '/dev/uinput', '/dev/uhid'], nvidiaRuntime: false, nvidiaModeset: null }, RUN)
  assert.equal(c.gpu, 'intel-amd')
  assert.equal(c.allGood, true)
  assert.deepEqual(c.items.map((i) => i.id), ['gpu', 'controllers', 'dualsense'])
})

test('readiness: says what’s missing, and how to fix it', () => {
  const c = streamingCheck({ devices: [], nvidiaRuntime: false, nvidiaModeset: null }, RUN)
  assert.equal(c.gpu, null)
  assert.equal(c.allGood, false)
  const by = Object.fromEntries(c.items.map((i) => [i.id, i]))
  assert.equal(by.gpu!.ok, false)
  assert.match(by.gpu!.detail, /processor/)
  assert.deepEqual(by.controllers!.fix, ['sudo modprobe uinput', 'echo uinput | sudo tee -a /etc/modules-load.d/wolf.conf'])
  assert.equal(by.dualsense!.ok, false)
})

test('readiness: Nvidia needs Docker’s Nvidia runtime and modeset', () => {
  const noToolkit = streamingCheck({ devices: ['/dev/dri', '/dev/nvidia0', '/dev/uinput', '/dev/uhid'], nvidiaRuntime: false, nvidiaModeset: false }, RUN)
  assert.equal(noToolkit.gpu, null, 'an Nvidia card Docker can’t use doesn’t count')
  assert.match(noToolkit.items[0]!.fix!.join(' '), /NVIDIA Container Toolkit/)
  const noModeset = streamingCheck({ devices: ['/dev/nvidia0', '/dev/uinput', '/dev/uhid'], nvidiaRuntime: true, nvidiaModeset: false }, RUN)
  assert.equal(noModeset.gpu, 'nvidia')
  assert.equal(noModeset.items.find((i) => i.id === 'nvidia-modeset')!.ok, false)
  const good = streamingCheck({ devices: ['/dev/nvidia0', '/dev/uinput', '/dev/uhid'], nvidiaRuntime: true, nvidiaModeset: true }, RUN)
  assert.equal(good.allGood, true)
})

test('readiness: a folder too deep for Wolf’s sockets stops it before it starts', () => {
  assert.equal(wolfFolderProblem('/mnt/tank/finesse/config/wolf/run'), null)
  const deep = `/mnt/${'nested/'.repeat(12)}finesse/config/wolf/run`
  assert.match(wolfFolderProblem(deep)!, /too deep for Wolf/)
  const c = streamingCheck({ devices: ['/dev/dri', '/dev/uinput', '/dev/uhid'], nvidiaRuntime: false, nvidiaModeset: null }, { runDir: deep })
  assert.equal(c.items[0]!.id, 'folder')
  assert.equal(c.allGood, false)
  assert.match(c.blocked!, /^Finesse’s folder is too deep for Wolf. .*107 characters/)
  assert.doesNotMatch(c.items[0]!.detail, /too deep/, 'the line under the title doesn’t repeat it')
  assert.equal(streamingCheck({ devices: [], nvidiaRuntime: false, nvidiaModeset: null }, RUN).blocked, undefined)
})
