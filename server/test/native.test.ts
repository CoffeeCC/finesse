// The native Windows host, run here with a stand-in app (a small Node HTTP
// server behind a launcher script): hash-checked downloads, ports picked once,
// starting, crash recovery, stopping on purpose, logs, updates and leftovers.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import type { StackContext } from '../src/stack/catalog.ts'
import { NativeHost, type NativeApp, type NativeDeps } from '../src/stack/native.ts'
import { tmp } from './helpers.ts'

const APP_JS = `
const http = require('http')
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
console.log('booting on ' + port)
http.createServer((req, res) => {
  if (req.url === '/crash') { res.end('bye'); setTimeout(() => process.exit(3), 10); return }
  res.end('ok')
}).listen(port, '127.0.0.1', () => console.log('Startup complete'))
process.on('SIGTERM', () => process.exit(0))
`

const payload = Buffer.from('pretend zip')
const sum = createHash('sha256').update(payload).digest('hex')

async function freePort(): Promise<number> {
  const srv = createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as AddressInfo).port
  await new Promise((r) => srv.close(r))
  return port
}

function fakeApp(port: number, version = '1.0', sha256 = sum): NativeApp {
  return { version, url: 'https://example.invalid/app.zip', sha256, kind: 'zip', exe: 'fake/run', port, args: ({ port: p }) => ['--port', String(p)] }
}

function deps(apps: NativeDeps['apps'], extra: Partial<NativeDeps> = {}): NativeDeps {
  return {
    apps,
    fetch: (async () => new Response(payload, { headers: { 'content-length': String(payload.length) } })) as unknown as typeof fetch,
    unzip: (_file, dest) => {
      mkdirSync(join(dest, 'fake'), { recursive: true })
      writeFileSync(join(dest, 'fake', 'app.js'), APP_JS)
      writeFileSync(join(dest, 'fake', 'run'), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/app.js" "$@"\n`)
      chmodSync(join(dest, 'fake', 'run'), 0o755)
    },
    ...extra,
  }
}

function ctx(root: string): StackContext {
  return { hostRoot: root, hostData: join(root, 'data'), puid: 0, pgid: 0, timezone: 'Etc/UTC', network: 'none', exposeJellyfin: false, jellyfinPort: 8096, gpu: false }
}

async function until(what: string, ok: () => Promise<boolean> | boolean, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await ok()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.fail(`timed out waiting for ${what}`)
}

test('a download that doesn’t match its pinned hash is never used', async () => {
  const root = tmp()
  const host = new NativeHost(root, deps({ prowlarr: fakeApp(await freePort(), '1.0', '0'.repeat(64)) }))
  await assert.rejects(host.download('prowlarr'), /didn’t match the version Finesse was tested with/)
  assert.equal(existsSync(join(root, 'apps', 'prowlarr', '1.0')), false)
})

test('apps the host can’t run say so plainly', async () => {
  const host = new NativeHost(tmp(), deps({}))
  assert.equal(host.supports('wolf'), false)
  await assert.rejects(host.download('wolf'), /isn’t available on Windows yet/)
})

test('ports: the usual one when free, else the next free one, kept from then on', async () => {
  const root = tmp()
  const usual = await freePort()
  const blocker = createServer()
  await new Promise<void>((r) => blocker.listen(usual, '0.0.0.0', r))
  try {
    const host = new NativeHost(root, deps({ prowlarr: fakeApp(usual) }))
    await host.prepareNetwork(ctx(root))
    const picked = host.peer('prowlarr').port
    assert.notEqual(picked, usual)
    assert.equal(host.url('prowlarr'), `http://127.0.0.1:${picked}`)
    // A new Finesse process reads the same choice back.
    assert.equal(new NativeHost(root, deps({ prowlarr: fakeApp(usual) })).peer('prowlarr').port, picked)
  } finally {
    blocker.close()
  }
})

test('an app starts, comes back after a crash, and stays stopped when stopped', async () => {
  const root = tmp()
  const host = new NativeHost(root, deps({ prowlarr: fakeApp(await freePort()) }))
  const c = ctx(root)
  await host.prepareNetwork(c)
  host.ensureDirs(c, ['prowlarr'])
  try {
    assert.equal(await host.ensureService('prowlarr', c), true)
    await host.waitReady('prowlarr', undefined, 10000)
    assert.equal(await host.waitLog('prowlarr', /Startup complete/, 5000), true)
    const first = (await host.state('prowlarr', c))!
    assert.equal(first.running, true)
    assert.equal(first.updatePending, false)
    assert.match(first.image, /Prowlarr 1\.0/)
    // Nothing changed: nothing restarts.
    assert.equal(await host.ensureService('prowlarr', c), false)

    await fetch(`${host.url('prowlarr')}/crash`).then((r) => r.text())
    await until('the crash to be noticed', async () => !(await host.isRunning('prowlarr')))
    await until('it to start again', async () => (await host.state('prowlarr', c))!.running && (await host.state('prowlarr', c))!.startedAt !== first.startedAt)
    await host.waitReady('prowlarr', undefined, 10000)
    assert.match(await host.logs('prowlarr'), /booting on \d+/)

    await host.stop('prowlarr', 5)
    assert.equal(await host.isRunning('prowlarr'), false)
    await new Promise((r) => setTimeout(r, 1500))
    assert.equal(await host.isRunning('prowlarr'), false, 'a stopped app stays stopped')
    await host.start('prowlarr')
    await host.waitReady('prowlarr', undefined, 10000)
  } finally {
    await host.stopAll()
  }
})

test('a new pinned version shows as an update, and applying it restarts the app', async () => {
  const root = tmp()
  const port = await freePort()
  const c = ctx(root)
  const old = new NativeHost(root, deps({ prowlarr: fakeApp(port, '1.0') }))
  await old.prepareNetwork(c)
  await old.ensureService('prowlarr', c)
  await old.stopAll()
  // Finesse updated: same app, newer pin.
  const host = new NativeHost(root, deps({ prowlarr: fakeApp(port, '2.0') }))
  try {
    assert.equal((await host.state('prowlarr', c))!.updatePending, true)
    assert.equal(await host.ensureService('prowlarr', c), true)
    await host.waitReady('prowlarr', undefined, 10000)
    assert.equal((await host.state('prowlarr', c))!.updatePending, false)
    assert.equal(existsSync(join(root, 'apps', 'prowlarr', '2.0', '.finesse-ok')), true)
  } finally {
    await host.stopAll()
  }
})

test('removing an app forgets it but keeps its settings', async () => {
  const root = tmp()
  const c = ctx(root)
  const host = new NativeHost(root, deps({ prowlarr: fakeApp(await freePort()) }))
  await host.prepareNetwork(c)
  host.ensureDirs(c, ['prowlarr'])
  await host.ensureService('prowlarr', c)
  writeFileSync(join(root, 'config', 'prowlarr', 'config.xml'), '<Config/>')
  await host.removeService('prowlarr')
  assert.equal(await host.state('prowlarr', c), null)
  assert.equal((await host.managed()).size, 0)
  assert.equal(existsSync(join(root, 'config', 'prowlarr', 'config.xml')), true)
})

test('an app left running by a crashed Finesse is ended, but only if it’s really ours', async () => {
  const root = tmp()
  const c = ctx(root)
  const first = new NativeHost(root, deps({ prowlarr: fakeApp(await freePort()) }))
  await first.prepareNetwork(c)
  await first.ensureService('prowlarr', c)
  await first.stopAll()

  const killed: number[] = []
  const kill = (pid: number) => {
    killed.push(pid)
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    return true
  }
  // The saved process id now belongs to something else: left alone.
  const other = new NativeHost(root, deps({ prowlarr: fakeApp(first.peer('prowlarr').port) }, { kill, imageOf: () => 'notepad.exe' }))
  await other.ensureService('prowlarr', c)
  await other.stopAll()
  assert.equal(killed.length, 1, 'only the stop above')

  killed.length = 0
  const ours = new NativeHost(root, deps({ prowlarr: fakeApp(first.peer('prowlarr').port) }, { kill, imageOf: () => 'run' }))
  await ours.ensureService('prowlarr', c)
  assert.equal(killed.length, 1, 'the leftover was ended before starting')
  await ours.stopAll()
})

test('stopping asks the app itself first', async () => {
  const root = tmp()
  const c = ctx(root)
  const asked: string[] = []
  const host = new NativeHost(
    root,
    deps(
      { prowlarr: fakeApp(await freePort()) },
      {
        askToStop: async (id, url) => {
          asked.push(id)
          await fetch(`${url}/crash`).then((r) => r.text())
          return true
        },
      },
    ),
  )
  await host.prepareNetwork(c)
  await host.ensureService('prowlarr', c)
  await host.waitReady('prowlarr', undefined, 10000)
  await host.stop('prowlarr', 10)
  assert.deepEqual(asked, ['prowlarr'])
  assert.equal(await host.isRunning('prowlarr'), false)
})
