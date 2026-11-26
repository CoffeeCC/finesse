import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { Auth } from '../src/auth.ts'
import { SettingsStore } from '../src/config.ts'
import { GameStoreDb, publicRequest, type StoredRequest } from '../src/gamestore/db.ts'
import { checkSplitArchive, finishAfterPerson, install, INSTALLED, pickInstaller, UNPACKED } from '../src/gamestore/install.ts'
import { Pipeline, type Installer, type PipelineDeps } from '../src/gamestore/pipeline.ts'
import { detectRedistHints, findProgram, findPrograms } from '../src/gamestore/program.ts'
import { buildProtonLaunch, parseGameManifest, serializeGameManifest } from '../src/gamestore/proton.ts'
import { registerGameStore } from '../src/gamestore/routes.ts'
import type { ExecutableCandidate, InstallOutcome, JobFile, LaunchResult, SandboxRunner, SurveyedFile } from '../src/gamestore/types.ts'
import { ApiError, Router, sendError } from '../src/http/core.ts'
import type { Sniffed } from '../src/installerSniff.ts'
import { Jellyfin } from '../src/jellyfin.ts'
import { listen, tmp } from './helpers.ts'

const mib = 1 << 20
const file = (path: string, size = 1): JobFile => ({ path, size })
const archive: Sniffed = { kind: 'archive', format: 'archive', unpack: '7z', notes: [] }
const iso: Sniffed = { ...archive, format: 'Disc image (ISO)' }
const exe: Sniffed = { kind: 'unknown', format: 'Windows program', notes: [] }
const msi: Sniffed = { kind: 'msi', format: 'MSI', unpack: 'msiextract', notes: [] }
const ok = { exit: 0, hung: false, log: '' }
const realWindow = { title: 'Game', class: 'GameWindow', text: '', buttons: [], wantsInput: false }
const runningGame = { windows: [realWindow], screenshot: 'shot.png', log: '' } satisfies LaunchResult

test('ranks Unity, Unreal, Godot and RPG Maker by engine evidence', () => {
  for (const [program, supporting, reason, bonus] of [
    ['unity/Orchard.exe', 'unity/ORCHARD_DATA/globalgamemanagers', 'Unity game executable', 120],
    ['pack/Binaries/Win64/Farm-Win64-Shipping.exe', null, 'Unreal Engine shipping executable', 100],
    ['pack/Binaries/Win32/Farm-Win32-Shipping.exe', null, 'Unreal Engine shipping executable', 100],
    ['godot/Orchard.exe', 'godot/ORCHARD.PCK', 'Godot game executable', 100],
    ['rpg/Game.exe', 'rpg/WWW/index.html', 'RPG Maker executable', 90],
    ['rpg/Game.exe', 'rpg/data/Actors.json', 'RPG Maker executable', 90],
  ] as const) {
    const files = [file('Orchard.exe', 10 * mib), file(program), ...(supporting ? [file(supporting)] : [])]
    const ranked = findPrograms(files)
    assert.deepEqual(ranked.map((x) => x.path), [program, 'Orchard.exe'])
    assert.equal(ranked[0]!.reason, reason)
    assert.equal(ranked[0]!.score - ranked[1]!.score, bonus)
    assert.deepEqual(findProgram(files), { path: program, linux: false })
    assert.equal(findPrograms(files, { hint: 'ORCHARD.EXE' })[0]!.path, 'Orchard.exe')
  }
})

test('candidate ranking respects names, depth, size and platform', () => {
  const files = [
    file('big.exe', 100 * mib), file('dir/Orchard.exe', 99 * mib), file('OrchardSmall.exe', 1),
    file('OrchardAlt.exe', 2), { ...file('run.sh'), executable: true },
  ]
  assert.deepEqual(findPrograms(files, { names: ['Orchard'] }).map((f) => f.path),
    ['OrchardAlt.exe', 'OrchardSmall.exe', 'dir/Orchard.exe', 'big.exe', 'run.sh'])
  assert.equal(findPrograms(files, { linux: true })[0]!.path, 'run.sh')
  assert.equal(findPrograms(files, { linux: true, hint: 'dir\\Orchard.exe' })[0]!.path, 'dir/Orchard.exe')
  assert.equal(findProgram([]), null)
})

test('crash handlers, anti-cheat, redistributables and setup executables are excluded', () => {
  const excluded = [
    'UnityCrashHandler64', 'UE4PrereqSetup', 'UEPrereq', 'vc_redist.x64', 'vcredist_x86',
    'CrashReportClient', 'EasyAntiCheat_EOS_Setup', 'BattlEyeLauncher', 'Start_Protected_Game',
    'AntiCheatClient', 'Uninstall', 'Setup_Wizard', 'RedistLauncher', 'DirectXSetup', 'xnafx40_redist', 'OpenALInstaller',
  ]
  const files = [file('Orchard.exe'), ...excluded.map((stem) => file(`${stem}.exe`, 100 * mib)), file('_CommonRedist/custom.exe', 100 * mib)]
  assert.deepEqual(findPrograms(files, { hint: 'UnityCrashHandler64.exe' }).map((candidate) => candidate.path), ['Orchard.exe'])
})

test('redistributable hints are sorted, deduplicated and recognize legacy VC versions', () => {
  const paths = [
    '_CommonRedist/vcredist/2022/VC_redist.x64.exe', 'Redist/vcredist_x86.exe',
    'Redist/vcredist/2010/vcredist_x86.exe', 'Redist/vcredist/2013/vcredist_x64.exe',
    '_CommonRedist/DirectX/Jun2010/DXSETUP.exe', 'DirectX/Jun2010_D3DCompiler_47_x64.cab',
    'Redist/dotnet/4.8/NDP48-x86-x64-AllOS-ENU.exe', 'Redist/PhysX_9.msi',
    'Redist/xnafx40_redist.msi', 'Redist/oalinst.exe', 'game/OpenAL32.dll',
  ]
  assert.deepEqual(detectRedistHints(paths.map((p) => file(p))),
    ['d3dcompiler_47', 'd3dx9', 'dotnet48', 'openal', 'physx', 'vcrun2010', 'vcrun2013', 'vcrun2022', 'xna40'])
  assert.deepEqual(detectRedistHints([file('game.exe')]), [])
})

test('split archives report the first missing volume and accept complete case-insensitive sets', () => {
  for (const [paths, missing] of [
    [['Box.part01.rar', 'box.PART03.RAR'], 'Box.part02.rar'],
    [['Pack.7z.002'], 'Pack.7z.001'],
    [['Pack.7z.001', 'Pack.7z.003'], 'Pack.7z.002'],
    [['Disc.z01'], 'Disc.zip'],
    [['Disc.z01', 'Disc.z03', 'DISC.ZIP'], 'Disc.z02'],
  ] as const) assert.deepEqual(checkSplitArchive(paths.map((p) => file(p))), { ok: false, missing })
  assert.deepEqual(checkSplitArchive(['x.part1.rar', 'x.part2.rar', 'y.7z.001', 'y.7z.002', 'z.z01', 'Z.ZIP'].map((p) => file(p))), { ok: true })
})

test('installer choice respects hints and known installers, and opens a large archive before a helper', () => {
  const candidate = (path: string, size: number, sniffed: Sniffed): SurveyedFile => ({ ...file(path, size), sniffed })
  const helper = candidate('setup_helper.exe', mib, exe)
  const large = candidate('game.zip', 10 * mib, archive)
  const fiveTimes = candidate('small.zip', 5 * mib, archive)
  const tooSmall = candidate('patch.zip', 4 * mib, archive)
  const known = candidate('real.msi', mib, msi)
  assert.equal(pickInstaller([helper, large]), large)
  assert.equal(pickInstaller([helper, fiveTimes]), fiveTimes)
  assert.equal(pickInstaller([helper, tooSmall]), helper)
  assert.equal(pickInstaller([helper, large, known]), known)
  assert.equal(pickInstaller([helper, large, known], { hint: helper.path }), helper)
})

function fixture(launch: (p: string) => LaunchResult = () => runningGame) {
  const calls: string[] = []
  const folders = new Map<string, JobFile[]>()
  const runner: SandboxRunner = {
    host: 'linux',
    supports: () => ({}),
    list: async () => [],
    unpack: async (_tool, from, into) => {
      calls.push(`unpack ${from} -> ${into}`)
      if (from.endsWith('.zip')) folders.set(into, [file('disc.iso', 100 * mib)])
      else if (from.endsWith('.iso')) folders.set(into, [file('Setup.exe'), file('Redist/dotnet48.exe')])
      else throw new Error(`Unexpected archive: ${from}`)
      return ok
    },
    install: async (argv) => {
      calls.push(`install ${argv[0]}`)
      folders.set(INSTALLED, [file('Orchard.exe')])
      return ok
    },
    files: async (dir) => folders.get(dir) ?? [],
    clear: async (dir) => { folders.delete(dir) },
    launch: async (p) => {
      calls.push(`launch ${p}`)
      return launch(p)
    },
    windows: async () => [],
    click: async () => false,
    stop: async () => { calls.push('stop') },
  }
  const job = {
    runner, title: 'Orchard', files: [file('pack.zip', 100 * mib)],
    sniff: async (p: string) => p.endsWith('.zip') ? archive : p.endsWith('.iso') ? iso : exe,
  }
  return { job, calls, folders }
}

test('an incomplete split archive fails before sniffing or unpacking', async () => {
  const { job, calls } = fixture()
  const out = await install({ ...job, files: [file('game.7z.001'), file('game.7z.003')], sniff: async () => { throw new Error('unexpected sniff') } })
  assert.equal(out.state, 'failed')
  if (out.state === 'failed') assert.match(out.reason, /game\.7z\.002/)
  assert.deepEqual(calls, [])
})

test('follows zip to ISO to unknown Setup.exe using each parent’s unpack folder', async () => {
  const { job, calls } = fixture()
  const out = await install(job)
  assert.equal(out.state, 'ready')
  if (out.state === 'ready') {
    assert.equal(out.program, 'Orchard.exe')
    assert.deepEqual(out.redistHints, ['dotnet48'])
  }
  assert.deepEqual(calls, [
    `unpack download/pack.zip -> ${UNPACKED}`, `unpack ${UNPACKED}/disc.iso -> ${UNPACKED}-1`,
    `install ${UNPACKED}-1/Setup.exe`, `launch ${INSTALLED}/Orchard.exe`, 'stop',
  ])
})

test('proof tries the next ranked executable after an immediate exit or config error', async () => {
  for (const failure of [
    { windows: [], exited: 1, log: 'closed' },
    { windows: [{ ...realWindow, title: 'Configuration error', buttons: ['OK'] }], screenshot: 'config.png', log: '' },
    { windows: [{ ...realWindow, title: 'Launcher error' }], screenshot: 'config.png', log: '' },
  ]) {
    const { job, calls, folders } = fixture((p) => p.endsWith('/Orchard.exe') ? failure : runningGame)
    folders.set(INSTALLED, [file('Launcher.exe'), file('Orchard.exe'), file('Redist/oalinst.exe')])
    const out = await finishAfterPerson(job)
    assert.equal(out.state, 'ready')
    if (out.state === 'ready') {
      assert.equal(out.program, 'Launcher.exe')
      assert.deepEqual(out.redistHints, ['openal'])
    }
    assert.deepEqual(calls, ['stop', `launch ${INSTALLED}/Orchard.exe`, 'stop', `launch ${INSTALLED}/Launcher.exe`, 'stop'])
  }
})

test('proof limits automatic launch attempts to three and returns five choices on failure', async () => {
  const { job, calls, folders } = fixture(() => ({ windows: [], exited: 2, log: 'missing files' }))
  const programs = ['Orchard.exe', 'A.exe', 'B.exe', 'C.exe', 'D.exe', 'E.exe']
  folders.set(INSTALLED, [...programs.map((p) => file(p)), file('Redist/DXSETUP.exe')])
  const out = await finishAfterPerson(job)
  assert.equal(out.state, 'failed')
  if (out.state === 'failed') {
    assert.deepEqual(out.candidates?.map((c) => c.path), programs.slice(0, 5))
    assert.deepEqual(out.candidates?.[0], { path: 'Orchard.exe', linux: false, reason: 'Matches the game’s name' })
    assert.deepEqual(out.redistHints, ['d3dx9'])
  }
  assert.deepEqual(calls.filter((c) => c.startsWith('launch')), programs.slice(0, 3).map((p) => `launch ${INSTALLED}/${p}`))
})

test('Proton plans include umu, Gamescope, a CoW clone, and a round-trippable manifest', () => {
  const opts = {
    gameId: 'umu-orchard', dir: '/games/Orchard', program: 'bin/Orchard Game.exe', linux: false,
    protonPath: '/tools/GE-Proton', prefixRoot: '/prefixes', goldenPrefix: '/golden',
    redistHints: ['vcrun2022', 'd3dx9', 'd3dx9'],
    gamescope: { width: 1920, height: 1080, fullscreen: true, hdr: true, forceGrabCursor: true },
  }
  const plan = buildProtonLaunch(opts)
  assert.deepEqual(plan.argv, ['gamescope', '-W', '1920', '-H', '1080', '-f', '--hdr-enabled', '--force-grab-cursor', '--', 'umu-run', '/games/Orchard/bin/Orchard Game.exe'])
  assert.deepEqual(plan.env, {
    GAMEID: 'umu-orchard', PROTONPATH: '/tools/GE-Proton', WINEPREFIX: '/prefixes/umu-orchard', STORE: 'none', WINEDLLOVERRIDES: 'winemenubuilder.exe=d',
  })
  assert.equal(plan.prefixDir, '/prefixes/umu-orchard')
  assert.deepEqual(plan.prefixCloneCommand, ['cp', '-aT', '--reflink=auto', '--', '/golden', '/prefixes/umu-orchard'])
  assert.deepEqual(plan.gameManifest.redistHints, ['d3dx9', 'vcrun2022'])
  assert.deepEqual(parseGameManifest(serializeGameManifest(plan.gameManifest)), plan.gameManifest)
  assert.throws(() => parseGameManifest('{}'), /Invalid game manifest/)
  assert.throws(() => buildProtonLaunch({ ...opts, program: '../other.exe' }), /Invalid game manifest/)
  const unknown = buildProtonLaunch({ ...opts, gameId: undefined, gamescope: false, goldenPrefix: undefined })
  assert.equal(unknown.env.GAMEID, 'umu-0')
  assert.deepEqual(unknown.argv, ['umu-run', '/games/Orchard/bin/Orchard Game.exe'])
  assert.equal(unknown.prefixCloneCommand, null)
  assert.notEqual(unknown.prefixDir, buildProtonLaunch({ ...opts, gameId: undefined, dir: '/games/Other' }).prefixDir)
})

test('native games launch without Proton or a Wine prefix, with optional Gamescope', () => {
  const input = { linux: true, dir: '/games/native', program: 'start.sh' }
  const plan = buildProtonLaunch(input)
  assert.deepEqual(plan.argv, ['/games/native/start.sh'])
  assert.deepEqual(plan.env, {})
  assert.equal(plan.prefixDir, null)
  assert.equal(plan.prefixCloneCommand, null)
  assert.deepEqual(buildProtonLaunch({ ...input, gamescope: { fullscreen: false } }).argv, ['gamescope', '--', '/games/native/start.sh'])
  assert.throws(() => buildProtonLaunch({ ...input, gamescope: { width: 0 } }), /positive integers/)
})

const ownerId = 'a'.repeat(32)
const choice = { path: 'bin/Orchard.exe', linux: false, reason: 'Matches the game’s name' } satisfies ExecutableCandidate

function stored(overrides: Partial<StoredRequest> = {}): StoredRequest {
  return {
    id: 'orchard-request', gameId: 'orchard', sourceId: 'orchard-download', title: 'Orchard',
    userId: ownerId, platform: 'windows', installer: 'unknown', state: 'failed',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    candidates: [choice], redistHints: ['d3dx9'], ...overrides,
  }
}

function temporaryFolder(t: TestContext): string {
  const dir = tmp()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('legacy request tables migrate in place and picker metadata survives reopening', (t) => {
  const file = join(temporaryFolder(t), 'gamestore.db')
  const old = new DatabaseSync(file)
  const original = stored({ candidates: undefined, redistHints: undefined })
  try {
    old.exec(`
      CREATE TABLE game_request (
        id TEXT PRIMARY KEY, game_id TEXT NOT NULL, source_id TEXT NOT NULL, user_id TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
      );
    `)
    old.prepare('INSERT INTO game_request VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      original.id, original.gameId, original.sourceId, original.userId, original.state,
      original.createdAt, original.updatedAt, JSON.stringify(original),
    )
  } finally {
    old.close()
  }

  const migrated = new GameStoreDb(file)
  try {
    assert.deepEqual(migrated.request(original.id), JSON.parse(JSON.stringify(original)))
    migrated.advance(original.id, 'needs-you', { candidates: [choice], redistHints: ['d3dx9'] })
    const columns = migrated.db.prepare('SELECT candidates, redist_hints FROM game_request WHERE id = ?').get(original.id)
    assert.equal(columns?.candidates, JSON.stringify([choice]))
    assert.equal(columns?.redist_hints, '["d3dx9"]')
  } finally {
    migrated.db.close()
  }
  const reopened = new GameStoreDb(file)
  t.after(() => reopened.db.close())
  const updated = reopened.request(original.id)!
  assert.deepEqual(updated.candidates, [choice])
  assert.deepEqual(updated.redistHints, ['d3dx9'])
  assert.deepEqual(reopened.activeRequest(original.gameId), updated)
  assert.deepEqual(reopened.requests(), [updated])
  assert.deepEqual(publicRequest(updated).candidates, [choice])
  assert.deepEqual(publicRequest(updated).redistHints, ['d3dx9'])
  assert.ok(!('candidates' in publicRequest(stored({ candidates: [] }))))
  assert.ok(!('redistHints' in publicRequest(stored({ redistHints: [] }))))
})

function pickerPipeline(db: GameStoreDb, installer: Partial<Installer> = {}, downloaderFor: PipelineDeps['downloaderFor'] = () => { throw new Error('Unexpected downloader call') }) {
  return new Pipeline({
    db,
    installer: {
      install: async () => { throw new Error('Unexpected install call') },
      finish: async () => { throw new Error('Unexpected finish call') },
      remove: async () => {},
      ...installer,
    },
    freeBytes: async () => Infinity,
    downloaderFor,
  })
}

function ready(program: string): InstallOutcome {
  return { state: 'ready', by: 'needs-you', program, dir: INSTALLED, log: [] }
}

test('pipeline persists installer diagnostics, validates choices and clears candidates after launch', async (t) => {
  const db = new GameStoreDb(':memory:')
  t.after(() => db.db.close())
  const r = stored({ state: 'installing', candidates: undefined, redistHints: undefined, folder: '/downloads/orchard' })
  db.saveRequest(r)
  const pipeline = pickerPipeline(db, {
    install: async () => ({ state: 'failed', reason: 'The first three programs did not start.', candidates: [choice], redistHints: ['d3dx9'], log: [] }),
    pickProgram: async (id, program) => {
      assert.equal(id, r.id)
      assert.equal(program, choice.path)
      assert.equal(db.request(id)?.state, 'finishing')
      assert.equal(db.request(id)?.pendingProgram, program)
      return ready(program)
    },
  })
  await pipeline.tick()
  const failed = db.request(r.id)!
  assert.equal(failed.state, 'failed')
  assert.deepEqual(failed.candidates, [choice])
  assert.deepEqual(failed.redistHints, ['d3dx9'])
  const badRequest = (e: unknown) => e instanceof ApiError && e.status === 400
  for (const program of ['../evil.exe', '/evil.exe', 'bin\\Orchard.exe', 'game\0.exe', 'unknown.exe']) {
    await assert.rejects(pipeline.pickProgram(failed, program), badRequest)
  }
  assert.deepEqual(db.request(r.id), failed)

  const result = await pipeline.pickProgram(failed, choice.path)
  assert.equal(result.state, 'ready')
  assert.equal(result.program, choice.path)
  assert.equal(result.candidates, undefined)
  assert.equal(result.pendingProgram, undefined)
  assert.deepEqual(result.redistHints, ['d3dx9'])
  assert.deepEqual(db.events(r.id).map((event) => event.state), ['failed', 'finishing', 'finishing', 'ready'])
})

test('failed candidate checks preserve choices and the finish fallback gets the program hint', async (t) => {
  const db = new GameStoreDb(':memory:')
  t.after(() => db.db.close())
  const r = stored({ state: 'needs-you' })
  db.saveRequest(r)
  let complete!: (outcome: InstallOutcome) => void
  const outcome = new Promise<InstallOutcome>((resolve) => { complete = resolve })
  const pipeline = pickerPipeline(db, {
    finish: async (request, opts) => {
      assert.equal(request.id, r.id)
      assert.equal(opts?.programHint, choice.path)
      return outcome
    },
  })
  const choosing = pipeline.pickProgram(r, choice.path)
  await assert.rejects(pipeline.pickProgram(r, choice.path), (e: unknown) => e instanceof ApiError && e.status === 409)
  complete({ state: 'failed', reason: 'The selected program closed.', log: [], redistHints: ['vcrun2022'] })
  const result = await choosing
  assert.equal(result.state, 'failed')
  assert.deepEqual(result.candidates, [choice])
  assert.deepEqual(result.redistHints, ['vcrun2022'])
  assert.equal(result.pendingProgram, undefined)
})

test('retry clears candidates and an interrupted check resumes with the chosen program', async (t) => {
  const db = new GameStoreDb(':memory:')
  t.after(() => db.db.close())
  const restart = stored({ state: 'finishing', pendingProgram: choice.path })
  db.saveRequest(restart)
  const pipeline = pickerPipeline(db, {
    pickProgram: async (id, program) => {
      assert.equal(id, restart.id)
      assert.equal(program, choice.path)
      return ready(program)
    },
  })
  await pipeline.tick()
  assert.equal(db.request(restart.id)?.state, 'ready')
  assert.equal(db.request(restart.id)?.pendingProgram, undefined)

  const failed = stored({
    id: 'retry-request', gameId: 'pear',
    source: { id: 'pear-source', gameId: 'pear', platform: 'windows', installer: 'unknown', sizeBytes: 100 },
  })
  db.saveRequest(failed)
  let availabilityChecks = 0
  const retrying = pickerPipeline(db, {}, () => ({
    available: async () => ++availabilityChecks === 1 ? { ok: true } : { ok: false, why: 'Waiting for downloads' },
    add: async () => { throw new Error('Unexpected add call') },
    status: async () => ({ state: 'missing', progress: 0 }),
    pause: async () => {},
    resume: async () => {},
    remove: async () => {},
  }))
  const retry = await retrying.retry(failed)
  assert.equal(retry.state, 'queued')
  assert.equal(retry.candidates, undefined)
  assert.equal(db.request(failed.id)?.candidates, undefined)
  await retrying.tick()
})

test('POST /api/games/store/requests/:id/program checks ownership and returns the public request', async (t) => {
  const dir = temporaryFolder(t)
  const settings = new SettingsStore({
    configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'invites.db'),
    bakedWeb: dir, updatedWeb: dir, backups: dir, previews: dir,
  })
  settings.update((s) => { s.gameStore = { enabled: true } })
  const jf = new Jellyfin(settings)
  t.mock.method(jf, 'me', async (token: string) => {
    if (token === 'owner') return { Id: ownerId, Name: 'Owner' }
    if (token === 'other') return { Id: 'b'.repeat(32), Name: 'Other' }
    return null
  })
  const db = new GameStoreDb(':memory:')
  t.after(() => db.db.close())
  const router = new Router()
  const store = registerGameStore(router, { settings, auth: new Auth(settings, jf), db })
  store.pipeline = pickerPipeline(db, { pickProgram: async (_id, program) => ready(program) })
  const row = stored({ state: 'needs-you' })
  db.saveRequest(row)
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    void router.dispatch({ req, res, url, path: url.pathname }).catch((error) => sendError(res, error))
  })
  const base = await listen(server)
  t.after(() => {
    server.closeAllConnections()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const endpoint = `${base}/api/games/store/requests/${row.id}/program`
  const post = (token: string, program: unknown) => fetch(endpoint, {
    method: 'POST', headers: { 'X-Emby-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ program }),
  })
  for (const [token, program, status] of [
    ['', choice.path, 401], ['other', choice.path, 403], ['owner', ' ', 400],
    ['owner', '../evil.exe', 400], ['owner', 'other.exe', 400],
  ] as const) {
    const res = await post(token, program)
    assert.equal(res.status, status)
    await res.json()
  }
  assert.equal(db.request(row.id)?.state, 'needs-you')
  const list = await fetch(`${base}/api/games/store/requests`, { headers: { 'X-Emby-Token': 'owner' } })
  assert.deepEqual(await list.json(), [publicRequest(row)])

  const res = await post('owner', choice.path)
  assert.equal(res.status, 200)
  const updated = await res.json()
  assert.deepEqual(updated, publicRequest(db.request(row.id)!))
  assert.equal(updated.state, 'ready')
  assert.deepEqual(updated.redistHints, ['d3dx9'])
  for (const field of ['candidates', 'userId', 'program', 'pendingProgram', 'installDir']) assert.ok(!(field in updated))
})
