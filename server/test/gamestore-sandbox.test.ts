// The Linux install sandbox (server/src/gamestore/sandbox.ts) against a pretend Docker: the
// container is sealed off the way the plan says, the in-sandbox command's lines are read right,
// a finished install leaves nothing running, "Needs you" keeps its sandbox for the screen, and a
// restart's leftovers are swept. (The real image runs in the installer lab: tools/installer-lab.)

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import type { StoredRequest } from '../src/gamestore/db.ts'
import { DockerInstaller, DockerSandbox, type SandboxDocker } from '../src/gamestore/sandbox.ts'

/** Docker's exec framing: an 8-byte header (stream, length) per piece. */
const frame = (text: string, stream = 1) => {
  const body = Buffer.from(text)
  const h = Buffer.alloc(8)
  h[0] = stream
  h.writeUInt32BE(body.length, 4)
  return Buffer.concat([h, body])
}

/** What the sandbox prints for a command; null keeps it running until something is stopped (an installer waiting on a page). */
type Answer = (args: string[]) => string | null
function fakeDocker(answer: Answer) {
  const held: PassThrough[] = []
  const calls: string[][] = []
  const created: { name: string; config: Record<string, unknown> }[] = []
  const removed: string[] = []
  let containers: { Id: string; Labels: Record<string, string> }[] = []
  const docker: SandboxDocker = {
    async execAttach(_c, cmd) {
      calls.push(cmd)
      const s = new PassThrough()
      if (cmd[1] === 'stop') for (const h of held.splice(0)) h.end(frame('@result {"exit":null,"hung":false}\n'))
      const out = answer(cmd.slice(1))
      if (out === null) {
        held.push(s)
        return { id: 'exec1', stream: s }
      }
      // Split across chunks the way a socket would.
      const all = Buffer.concat([frame('warning from wine\n', 2), frame(out)])
      setImmediate(() => {
        s.write(all.subarray(0, 5))
        s.end(all.subarray(5))
      })
      return { id: 'exec1', stream: s }
    },
    async execExitCode() {
      return 0
    },
    async create(name, config) {
      created.push({ name, config })
      containers.push({ Id: name, Labels: (config.Labels as Record<string, string>) ?? {} })
      return name
    },
    async start() {},
    async remove(id) {
      removed.push(id)
      containers = containers.filter((c) => c.Id !== id)
    },
    async list() {
      return containers as never
    },
    async imageExists() {
      return true
    },
    async pull() {},
    async imageInspect() {
      return { Id: 'img', RepoDigests: [], Config: { Labels: { 'finesse.innoextract.max': '6.4.999' } } } as never
    },
  }
  return { docker, calls, created, removed, setContainers: (c: typeof containers) => (containers = c) }
}

test('the sandbox reads progress, the result and the log from the command, split however it arrives', async () => {
  const progress: number[] = []
  const { docker } = fakeDocker(() => '@progress 100\n@progress 2048\nunpacked app/game.exe\n@result {"exit":0,"hung":false}\n')
  const box = new DockerSandbox(docker, 'c1')
  const r = await box.unpack('innoextract', 'download/setup.exe', 'install/unpacked', (n) => progress.push(n))
  assert.deepEqual(r, { exit: 0, hung: false, log: 'unpacked app/game.exe' })
  assert.deepEqual(progress, [100, 2048])
  assert.deepEqual(box.supports('innoextract'), { maxVersion: '6.4.999' })
})

test('install: the hang limit goes in seconds, a hang has no exit code, and a moved folder comes back', async () => {
  const { docker, calls } = fakeDocker((a) => (a[0] === 'install' ? 'Message box (OK)\n@result {"exit":null,"hung":true}\n' : '@result {"exit":0,"hung":false,"dir":"install/game"}\n'))
  const box = new DockerSandbox(docker, 'c1')
  const hung = await box.install(['download/setup.exe', '/VERYSILENT', '/DIR=<dir>'], { hangAfterMs: 120_000 })
  assert.deepEqual(hung, { exit: null, hung: true, log: 'Message box (OK)' })
  assert.deepEqual(calls[0], ['finesse-sandbox', 'install', '120', '--', 'download/setup.exe', '/VERYSILENT', '/DIR=<dir>'])
  // Shown (clicked through): no limit here, the engine watches the windows instead.
  await box.install(['download/setup.exe'], { shown: true })
  assert.equal(calls[1]![2], '0')
})

test('files, windows and clicks come back in the engine’s terms', async () => {
  const { docker, calls } = fakeDocker((a) => {
    if (a[0] === 'files') return 'app/game.exe\t5242880\t644\nbin/game\t100\t755\n@result {"ok":true}\n'
    if (a[0] === 'windows') return '@result {"windows":[{"hwnd":65562,"pid":32,"title":"Setup","class":"#32770","text":"Install now?","buttons":["&Yes","&No"],"wantsInput":false,"hung":false,"width":300,"height":120}]}\n'
    if (a[0] === 'click') return '@result {"ok":true}\n'
    if (a[0] === 'launch') return '@result {"windows":[{"hwnd":1,"title":"Game","class":"GameWindow","text":"","buttons":[],"wantsInput":false}],"exited":null,"screenshot":"install/.sandbox/start.png"}\n'
    return '@result {"ok":true}\n'
  })
  const box = new DockerSandbox(docker, 'c1')
  assert.deepEqual(await box.files('install/unpacked'), [
    { path: 'app/game.exe', size: 5242880 },
    { path: 'bin/game', size: 100, executable: true },
  ])
  const [w] = await box.windows()
  assert.deepEqual(w, { title: 'Setup', class: '#32770', text: 'Install now?', buttons: ['&Yes', '&No'], wantsInput: false, hwnd: '65562' })
  assert.equal(await box.click(w!, '&Yes'), true)
  assert.deepEqual(calls.at(-1), ['finesse-sandbox', 'click', '65562', '&Yes'])
  // A window without a handle can't be clicked.
  assert.equal(await box.click({ ...w!, hwnd: undefined }, 'Yes'), false)
  const started = await box.launch('install/unpacked/app/game.exe', { waitMs: 60_000 })
  assert.equal(started.screenshot, 'install/.sandbox/start.png')
  assert.equal(started.exited, undefined)
  assert.deepEqual(calls.at(-1), ['finesse-sandbox', 'launch', 'install/unpacked/app/game.exe', '60'])
})

const request = (id: string): StoredRequest =>
  ({ id, gameId: 'g', title: 'Test Game', sourceId: 's', platform: 'windows', installer: 'inno', state: 'installing', sizeBytes: 1, requestedBy: 'Ann', userId: 'u', createdAt: '', updatedAt: '' }) as StoredRequest

/** A pretend sandbox: the download is a zip; unpacking it gives the game, which starts. */
const plainInno = (a: string[]) => {
  if (a[0] === 'files' && a[1] === 'download') return 'game.zip\t4096\t644\n@result {"ok":true}\n'
  if (a[0] === 'files') return 'app/game.exe\t120000\t644\n@result {"ok":true}\n'
  if (a[0] === 'list') return 'app/game.exe\n@result {"ok":true}\n'
  if (a[0] === 'unpack') return '@result {"exit":0,"hung":false}\n'
  if (a[0] === 'launch') return '@result {"windows":[{"hwnd":1,"title":"Test Game","class":"GameWindow","text":"","buttons":[],"wantsInput":false}],"exited":null,"screenshot":"install/.sandbox/start.png"}\n'
  return '@result {"ok":true}\n'
}

/** A Windows program with a block of data appended that Finesse doesn't know: an unknown installer. */
function mysteryInstaller(): Buffer {
  const b = Buffer.alloc(0x600)
  b.write('MZ', 0, 'latin1')
  b.writeUInt32LE(0x80, 0x3c)
  b.writeUInt32LE(0x00004550, 0x80)
  b.writeUInt16LE(0x14c, 0x84)
  b.writeUInt16LE(1, 0x86)
  b.writeUInt16LE(0xe0, 0x94)
  b.writeUInt16LE(0x10b, 0x98)
  b.writeUInt16LE(2, 0x98 + 68)
  b.write('.text', 0x98 + 0xe0, 'latin1')
  b.writeUInt32LE(0x200, 0x98 + 0xe0 + 16)
  b.writeUInt32LE(0x400, 0x98 + 0xe0 + 20)
  return Buffer.concat([b, Buffer.alloc(2 * 1024 * 1024, 7)])
}

async function lab() {
  const data = await mkdtemp(join(tmpdir(), 'finesse-sandbox-'))
  const download = join(data, 'downloads', 'games', 'r1')
  await mkdir(download, { recursive: true })
  const zip = Buffer.alloc(4096)
  zip.write('PK\x03\x04', 0, 'latin1')
  await writeFile(join(download, 'game.zip'), zip)
  await writeFile(join(download, 'setup.exe'), mysteryInstaller())
  return { data, download }
}

test('a container per install, sealed off: no network, no privileges, limits, the download read-only', async () => {
  const { data, download } = await lab()
  const fake = fakeDocker(plainInno)
  const installer = new DockerInstaller({ docker: fake.docker, image: 'finesse-installer:test', where: () => ({ hostData: data, puid: 568, pgid: 568 }), instance: 'inst-1' })
  await installer.install(request('r1'), download, () => {})
  const c = fake.created[0]!
  assert.equal(c.name, 'finesse-install-r1')
  const host = c.config.HostConfig as Record<string, unknown>
  assert.equal(host.NetworkMode, 'none')
  assert.equal(c.config.NetworkDisabled, true)
  assert.deepEqual(host.CapDrop, ['ALL'])
  assert.ok((host.SecurityOpt as string[]).includes('no-new-privileges'))
  assert.ok((host.Memory as number) > 0 && (host.NanoCpus as number) > 0 && (host.PidsLimit as number) > 0)
  assert.equal(c.config.User, '568:568')
  assert.deepEqual(host.Mounts, [
    { Type: 'bind', Source: download, Target: '/job/download', ReadOnly: true },
    { Type: 'bind', Source: join(data, 'media', 'games', 'pc', 'r1'), Target: '/job/install', ReadOnly: false },
  ])
  assert.equal(host.Binds, undefined, 'nothing else is mounted (no Docker socket)')
  assert.deepEqual(c.config.Labels, { 'finesse.managed': 'true', 'finesse.job': 'install', 'finesse.request': 'r1', 'finesse.instance': 'inst-1' })
  await rm(data, { recursive: true, force: true })
})

test('a finished install leaves no container; the game is kept, its folders said from the games folder', async () => {
  const { data, download } = await lab()
  const fake = fakeDocker(plainInno)
  const installer = new DockerInstaller({ docker: fake.docker, image: 'img', where: () => ({ hostData: data, puid: 0, pgid: 0 }) })
  const steps: string[] = []
  const out = await installer.install(request('r1'), download, (t) => steps.push(t))
  assert.equal(out.state, 'ready')
  assert.ok(out.state === 'ready' && out.dir === 'r1/unpacked' && out.screenshot === 'r1/.sandbox/start.png' && out.program === 'app/game.exe', JSON.stringify(out))
  assert.deepEqual(await fake.docker.list({}), [], 'removed when done')
  // Root never runs it: a server with no user of its own gets the image's.
  assert.equal(fake.created[0]!.config.User, '1000:1000')
  assert.ok(steps.some((s) => /It starts/.test(s)), steps.join(' | '))
  await rm(data, { recursive: true, force: true })
})

test('"Needs you": the sandbox stays for the screen, and goes once the person is done', async () => {
  const { data, download } = await lab()
  // The person finishes the installer on its screen: the game's files are there after that.
  let finished = false
  const fake = fakeDocker((a) => {
    if (a[0] === 'stop') finished = true
    if (a[0] === 'files' && a[1] === 'download') return 'setup.exe\t2098688\t644\n@result {"ok":true}\n'
    if (a[0] === 'files') return finished ? 'game.exe\t120000\t644\n@result {"ok":true}\n' : '@result {"ok":true}\n'
    if (a[0] === 'install') return null
    // Every way left: a page asking for a name.
    if (a[0] === 'windows') return '@result {"windows":[{"hwnd":7,"title":"Setup - Test Game","class":"TWizardForm","text":"Enter your player name","buttons":["&Next >","Cancel"],"wantsInput":true}]}\n'
    return plainInno(a)
  })
  const installer = new DockerInstaller({ docker: fake.docker, image: 'img', where: () => ({ hostData: data, puid: 568, pgid: 568 }) })
  // Unknown program: the engine goes straight to clicking it through.
  const r = request('r2')
  const out = await installer.install(r, download, () => {})
  assert.equal(out.state, 'needs-you', JSON.stringify(out))
  const alive = async () => (await fake.docker.list({})).some((c) => c.Id === 'finesse-install-r2')
  assert.ok(await alive(), 'kept for the screen')
  assert.ok(await installer.screen(r), 'its screen can be opened')
  const done = await installer.finish(r)
  assert.equal(done.state, 'ready', JSON.stringify(done))
  assert.ok(!(await alive()), 'gone once the person is done')
  assert.equal(await installer.screen(r), null)
  await rm(data, { recursive: true, force: true })
})

test('remove deletes the container and the install folder, never the download; leftovers are swept', async () => {
  const { data, download } = await lab()
  const fake = fakeDocker(plainInno)
  const installer = new DockerInstaller({ docker: fake.docker, image: 'img', where: () => ({ hostData: data, puid: 568, pgid: 568 }), instance: 'me' })
  await installer.install(request('r1'), download, () => {})
  await installer.remove(request('r1'))
  await assert.rejects(stat(join(data, 'media', 'games', 'pc', 'r1')))
  assert.deepEqual((await readdir(download)).sort(), ['game.zip', 'setup.exe'], 'the download is kept for "Try again"')

  fake.setContainers([
    { Id: 'mine', Labels: { 'finesse.managed': 'true', 'finesse.job': 'install', 'finesse.instance': 'me' } },
    { Id: 'another-finesse', Labels: { 'finesse.managed': 'true', 'finesse.job': 'install', 'finesse.instance': 'other' } },
  ])
  assert.equal(await installer.sweep(), 1)
  assert.ok(fake.removed.includes('mine') && !fake.removed.includes('another-finesse'))
  await rm(data, { recursive: true, force: true })
})

test('no Docker: the request fails saying what to check, and keeps its download', async () => {
  const { data, download } = await lab()
  const fake = fakeDocker(plainInno)
  fake.docker.create = async () => {
    throw new Error('connect ENOENT /var/run/docker.sock')
  }
  const installer = new DockerInstaller({ docker: fake.docker, image: 'img', where: () => ({ hostData: data, puid: 568, pgid: 568 }) })
  const out = await installer.install(request('r1'), download, () => {})
  assert.equal(out.state, 'failed')
  assert.match(out.state === 'failed' ? out.reason : '', /can’t reach Docker/)
  assert.deepEqual((await readdir(download)).sort(), ['game.zip', 'setup.exe'])
  await rm(data, { recursive: true, force: true })
})
