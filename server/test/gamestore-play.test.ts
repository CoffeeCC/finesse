// Play (WS6) with a pretend Wolf and a pretend desktop. Nothing here starts a container.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GameStoreDb, type StoredRequest } from '../src/gamestore/db.ts'
import {
  BAD_FILES,
  NO_SCREEN,
  NO_VIDEO,
  STREAM_OFF,
  STREAM_WINDOWS,
  createStorePlay,
  displayFromListing,
  ensureWolfGame,
  forgetWolfGame,
  gameAppId,
  gameHostDir,
  launchLine,
  type LocalSpec,
  safeRelative,
  storeWolfApp,
  windowsSession,
  type PlayDeps,
  type WolfPlay,
} from '../src/gamestore/play.ts'

const video = { h264_gst_pipeline: 'h', hevc_gst_pipeline: 'e', av1_gst_pipeline: 'a', render_node: '/dev/dri/renderD128', opus_gst_pipeline: 'o' }

const ready = (more: Partial<StoredRequest> = {}): StoredRequest => ({
  id: 'abc123',
  gameId: 'g',
  title: 'SuperTux',
  sourceId: 's',
  platform: 'windows',
  installer: 'inno',
  state: 'ready',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  userId: 'user',
  installDir: 'abc123/app',
  program: 'bin/supertux2.exe',
  ...more,
})

test('a game path cannot leave its folder', () => {
  assert.equal(safeRelative('bin/game.exe'), 'bin/game.exe')
  assert.equal(safeRelative('../etc/passwd'), null)
  assert.equal(safeRelative('/usr/bin/id'), null)
  assert.equal(safeRelative('a\\..\\b'), null)
  assert.equal(gameHostDir('/data/media/games/pc', 'abc/app'), '/data/media/games/pc/abc/app')
  assert.equal(gameHostDir('/data/media/games/pc', 'abc/../../etc'), null)
})

test('Windows games use a Wine prefix inside the game folder; Linux games run directly', () => {
  const win = launchLine({ id: 'a', title: 'T', dir: 'a/app', program: 'bin/game.exe', linux: false })
  assert.ok(win)
  assert.match(win!, /WINEPREFIX=\/game\/\.finesse-prefix/)
  assert.match(win!, /exec wine '\/game\/bin\/game.exe'/)
  assert.match(win!, /DXVK_STATE_CACHE_PATH/)
  const lin = launchLine({ id: 'a', title: 'T', dir: 'a/app', program: 'bin/game', linux: true })
  assert.match(lin!, /exec '\/game\/bin\/game'/)
  assert.equal(launchLine({ id: 'a', title: 'T', dir: 'a', program: '../x', linux: true }), null)
})

test('the Wolf app mounts only the game folder and is not one of the emulator apps', () => {
  const app = storeWolfApp({ id: 'abc123', title: 'SuperTux', dir: 'abc123/app', program: 'bin/game.exe', linux: false }, video, '/data/media/games/pc/abc123/app')
  assert.ok(app)
  assert.equal(app!.id, gameAppId('abc123'))
  const runner = app!.runner as { name: string; mounts: string[]; env: string[] }
  assert.equal(runner.mounts.length, 1)
  assert.match(runner.mounts[0]!, /\/data\/media\/games\/pc\/abc123\/app:\/game:rw$/)
  assert.equal(runner.name.startsWith('Finesse-'), false)
  assert.match(runner.env.find((e) => e.startsWith('FINESSE_LAUNCH='))!, /wine/)
  const created = JSON.parse((app!.runner as { base_create_json: string }).base_create_json) as { Cmd: string[] }
  assert.deepEqual(created.Cmd, ['exec gosu "${UNAME:-retro}" bash -c "$FINESSE_LAUNCH"'])
  assert.equal(storeWolfApp({ id: 'a', title: 'T', dir: 'a', program: 'g', linux: true }, video, 'C:/odd:path'), null)
})

test('a desktop is an X socket or a Wayland socket, and Windows wants someone signed in', () => {
  assert.deepEqual(displayFromListing(''), null)
  assert.deepEqual(displayFromListing('X0\nX1'), { display: ':0' })
  assert.deepEqual(displayFromListing('/run/user/1000/wayland-0'), { display: 'wayland-0', wayland: 'wayland-0' })
  assert.equal(windowsSession(' USER NAME\n').ok, false)
  assert.equal((windowsSession(' USER NAME\n>paul console 1 Active none') as { ok: true }).ok, true)
  assert.equal(windowsSession(' USER NAME\n paul console 1 Disc none').ok, false)
})

test('Wolf gains the game once, keeps a profile that refuses the change, and drops it on uninstall', async () => {
  const profiles: Record<string, unknown>[] = [{ id: 'p1', name: 'User', apps: [{ id: 'other', title: 'Steam', runner: { name: 'WolfSteam' } }] }]
  const added: unknown[] = []
  let removed: string[] = []
  let boomAdds = 0
  const wolf: WolfPlay = {
    lists: async () => ({ apps: [], profiles: profiles.map((p) => ({ ...p, apps: [...(p.apps as unknown[])] })) }),
    video: () => video,
    addApp: async (a) => void added.push(a),
    deleteApp: async () => {},
    removeProfile: async (id) => {
      removed.push(id)
      const i = profiles.findIndex((p) => p.id === id)
      if (i >= 0) profiles.splice(i, 1)
    },
    addProfile: async (p) => {
      if (p.id === 'boom' && ++boomAdds === 1) throw new Error('refused')
      profiles.push(p)
    },
  }
  const app = storeWolfApp({ id: 'abc123', title: 'SuperTux', dir: 'abc123/app', program: 'g.exe', linux: false }, video, '/g')!
  await ensureWolfGame(wolf, app)
  assert.equal(added.length, 0)
  assert.equal((profiles[0]!.apps as { id: string }[]).some((a) => a.id === gameAppId('abc123')), true)
  const before = JSON.stringify(profiles)
  await ensureWolfGame(wolf, app)
  assert.equal(JSON.stringify(profiles), before, 'a second ensure does not rewrite Wolf')

  profiles.push({ id: 'boom', apps: [] })
  await assert.rejects(() => ensureWolfGame(wolf, { ...app, id: 'new', title: 'Nope' }), /refused/)
  assert.equal(profiles.some((p) => p.id === 'boom'), true, 'a refused profile is put back')

  removed = []
  await forgetWolfGame(wolf, 'abc123')
  assert.equal((profiles.find((p) => p.id === 'p1')!.apps as { id: string }[]).some((a) => a.id === gameAppId('abc123')), false)
})

const playDeps = (over: Partial<PlayDeps> = {}): PlayDeps & { started: LocalSpec[] } => {
  const started: LocalSpec[] = []
  let last: { way: 'server' | 'stream'; target: string } | null = null
  const deps: PlayDeps & { started: typeof started } = {
    host: 'linux',
    serverName: 'Rig',
    gamesRoot: () => '/data/media/games/pc',
    desktop: async () => ({ ok: false, why: NO_SCREEN }),
    wolf: () => null,
    user: () => '950:950',
    startLocal: async (spec) => void started.push(spec),
    last: () => last,
    remember: (_u, way, target) => {
      last = { way, target }
    },
    started,
    ...over,
  }
  return deps
}

test('Play on the server is greyed out without a desktop, and Stream without Wolf', async () => {
  const play = createStorePlay(playDeps())
  const o = await play.options(ready(), 'user')
  assert.equal(o.serverName, 'Rig')
  assert.equal(o.ways.find((w) => w.way === 'server')!.why, NO_SCREEN)
  assert.equal(o.ways.find((w) => w.way === 'stream')!.why, STREAM_OFF)
  await assert.rejects(() => play.start(ready(), 'user', 'server', 'server'), new Error(NO_SCREEN))
})

test('a desktop starts the game on that display and remembers the choice', async () => {
  const deps = playDeps({ desktop: async () => ({ ok: true, display: ':0' }) })
  const play = createStorePlay(deps)
  await play.start(ready(), 'user', 'server', 'server')
  assert.equal(deps.started.length, 1)
  assert.equal(deps.started[0]!.display, ':0')
  assert.match(deps.started[0]!.command, /wine/)
  assert.match(deps.started[0]!.hostDir, /abc123\/app$/)
  assert.deepEqual(deps.last('user'), { way: 'server', target: 'server' })
  const again = await play.options(ready(), 'user')
  assert.deepEqual(again.last, { way: 'server', target: 'server' })
})

test('Stream adds a Wolf app; Windows says streaming isn’t set up; a bad path is refused', async () => {
  const apps: Record<string, unknown>[] = []
  const wolf: WolfPlay = {
    lists: async () => ({ apps, profiles: [] }),
    video: (all) => (all.length || true ? video : null),
    addApp: async (a) => void apps.push(a),
    deleteApp: async (id) => {
      const i = apps.findIndex((a) => a.id === id)
      if (i >= 0) apps.splice(i, 1)
    },
    removeProfile: async () => {},
    addProfile: async () => {},
  }
  const play = createStorePlay(playDeps({ wolf: () => wolf }))
  const started = await play.start(ready(), 'user', 'stream', 'browser')
  assert.equal(started.appId, gameAppId('abc123'))
  assert.equal(apps.length, 1)
  await play.start(ready(), 'user', 'stream', 'browser')
  assert.equal(apps.length, 1, 'the same game is not added twice')

  const win = createStorePlay(playDeps({ host: 'windows', wolf: () => wolf }))
  const o = await win.options(ready(), 'user')
  assert.equal(o.ways.find((w) => w.way === 'stream')!.why, STREAM_WINDOWS)

  const blind = createStorePlay(playDeps({ wolf: () => ({ ...wolf, video: () => null, lists: async () => ({ apps: [], profiles: [] }) }) }))
  assert.equal((await blind.options(ready(), 'user')).ways.find((w) => w.way === 'stream')!.why, NO_VIDEO)

  await assert.rejects(() => play.start(ready({ program: '../outside' }), 'user', 'stream', 'browser'), new Error(BAD_FILES))
  assert.equal(play.shot(ready({ screenshot: 'abc123/app/shot.png' })), '/data/media/games/pc/abc123/app/shot.png')
  assert.equal(play.shot(ready({ screenshot: '../secret' })), null)
})

test('the last choice is remembered in the store database', () => {
  const db = new GameStoreDb(':memory:')
  assert.equal(db.playChoice('u'), null)
  db.rememberPlay('u', 'stream', 'browser')
  assert.deepEqual(db.playChoice('u'), { way: 'stream', target: 'browser' })
  db.rememberPlay('u', 'server', 'server')
  assert.deepEqual(db.playChoice('u'), { way: 'server', target: 'server' })
})
