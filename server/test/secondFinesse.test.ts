// A second Finesse on the same Docker (trying it out next to the one you use) must never take
// over the first one's apps: every app is stamped with the Finesse that made it, setup stops
// before building over someone else's, and the stamp itself never makes an app restart.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { checkSystem } from '../src/setup/checks.ts'
import { scan } from '../src/setup/existing.ts'
import { CATALOG, type StackContext } from '../src/stack/catalog.ts'
import { Docker } from '../src/stack/docker.ts'
import { containerSpec, LABEL_INSTANCE, LABEL_MANAGED, LABEL_SERVICE, LABEL_SPEC, Orchestrator, specHash } from '../src/stack/orchestrator.ts'
import { fakeDocker, type FakeContainer } from './fakeDocker.ts'
import { tmp } from './helpers.ts'

const ME = 'me-0000'
const OTHER = 'other-1111'
const app = (svc: string, labels: Record<string, string> = {}): FakeContainer => ({ id: svc, name: `finesse-${svc}`, image: CATALOG[svc as 'sonarr'].image, labels: { [LABEL_MANAGED]: 'true', [LABEL_SERVICE]: svc, ...labels } })
const ctx = (): StackContext => ({ hostRoot: tmp('root-'), hostData: tmp('data-'), puid: 1000, pgid: 1000, timezone: 'Etc/UTC', network: 'finesse', exposeJellyfin: false, jellyfinPort: 8096, gpu: false, selinux: false, hostDevices: [] })

describe('another Finesse on the same Docker', () => {
  test('finds apps another Finesse made, stamped or from before the stamp', async () => {
    const fd = await fakeDocker([app('sonarr', { [LABEL_INSTANCE]: OTHER }), app('radarr'), app('lidarr', { [LABEL_INSTANCE]: ME }), { id: 'x', name: 'sonarr', image: 'lscr.io/linuxserver/sonarr' }])
    try {
      const orch = new Orchestrator(new Docker(fd.socket), ME)
      // A fresh Finesse: unstamped apps can't be its own.
      assert.deepEqual(await orch.foreignApps(false), ['finesse-radarr', 'finesse-sonarr'])
      // A Finesse that already built its stack (made before the stamp): unstamped apps are its own.
      assert.deepEqual(await orch.foreignApps(true), ['finesse-sonarr'])
    } finally {
      await fd.close()
    }
  })

  test('the "This machine" step stops setup and says why', async () => {
    const fd = await fakeDocker([app('jellyfin'), app('sonarr')])
    try {
      const orch = new Orchestrator(new Docker(fd.socket), ME)
      const fresh = await checkSystem(orch, { root: tmp('r-'), data: tmp('d-') }, { haveStack: false })
      const others = fresh.items.find((i) => i.id === 'others')
      assert.equal(fresh.ok, false)
      assert.equal(others?.ok, false)
      assert.match(others!.message, /finesse-jellyfin, finesse-sonarr/)
      // The Finesse that made them sees no problem.
      const mine = await checkSystem(orch, { root: tmp('r-'), data: tmp('d-') }, { haveStack: true })
      assert.equal(mine.items.find((i) => i.id === 'others'), undefined)
    } finally {
      await fd.close()
    }
  })

  test('refuses to replace an app another Finesse made, and touches nothing', async () => {
    const c = ctx()
    const fd = await fakeDocker([app('sonarr', { [LABEL_INSTANCE]: OTHER, [LABEL_SPEC]: 'old' })])
    try {
      const orch = new Orchestrator(new Docker(fd.socket), ME)
      await assert.rejects(orch.ensureService('sonarr', c), /belongs to another Finesse/)
      assert.deepEqual(fd.calls, [])
    } finally {
      await fd.close()
    }
  })

  test('stamping an app that is already right never recreates it', async () => {
    const c = ctx()
    const hash = specHash(containerSpec(CATALOG.sonarr, c))
    const fd = await fakeDocker([app('sonarr', { [LABEL_SPEC]: hash })])
    try {
      const orch = new Orchestrator(new Docker(fd.socket), ME)
      assert.equal(await orch.ensureService('sonarr', c), false)
      assert.deepEqual(fd.calls, [])
      // Its own (stamped) app with an old definition is updated as before.
      const fd2 = await fakeDocker([app('radarr', { [LABEL_INSTANCE]: ME, [LABEL_SPEC]: 'old' })])
      try {
        const o2 = new Orchestrator(new Docker(fd2.socket), ME)
        assert.equal(await o2.ensureService('radarr', c), true)
        assert.deepEqual(fd2.calls, ['stop finesse-radarr', 'remove finesse-radarr', 'create finesse-radarr', 'start finesse-radarr'])
      } finally {
        await fd2.close()
      }
    } finally {
      await fd.close()
    }
  })

  test('"Use the apps I already have" can find the other Finesse\'s apps, but not its own', async () => {
    const fd = await fakeDocker([app('sonarr'), app('radarr', { [LABEL_INSTANCE]: ME })])
    try {
      const docker = new Docker(fd.socket)
      const { result } = await scan({ docker, me: null, computer: false, instance: ME })
      const by = Object.fromEntries(result.apps.map((a) => [a.id, a]))
      assert.notEqual(by.sonarr!.state, 'not-found')
      assert.equal(by.radarr!.state, 'not-found')
    } finally {
      await fd.close()
    }
  })
})
