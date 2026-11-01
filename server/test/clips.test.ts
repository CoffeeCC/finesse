// Preview clips on every install: finding someone's own Jellyfin container, making clips in a
// throwaway container from its image (read-only library, lowest priority), and removing clips of
// titles Jellyfin no longer has, only after a complete listing.

import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { SettingsStore } from '../src/config.ts'
import { adoptEncoder, ClipMaker, mountFor, orphanClips, type ClipEncoder } from '../src/stack/clips.ts'
import { Docker } from '../src/stack/docker.ts'
import type { StackHost } from '../src/stack/host.ts'
import { findJellyfin, pickJellyfin } from '../src/stack/jellyfinContainer.ts'
import { fakeDocker } from './fakeDocker.ts'
import { listen, tmp } from './helpers.ts'

const id = (n: number) => n.toString(16).padStart(32, 'a')

function store(previews: string) {
  const dir = tmp()
  return new SettingsStore({ configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'i.db'), bakedWeb: dir, updatedWeb: dir, previews, backups: dir })
}

/** A Jellyfin answering /Items with `items` (or a status code). */
async function jellyfin(answer: () => { status?: number; body?: unknown }): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/Items')) {
      const a = answer()
      res.writeHead(a.status ?? 200, { 'Content-Type': 'application/json' })
      return void res.end(JSON.stringify(a.body ?? {}))
    }
    res.writeHead(404)
    res.end()
  })
  return { url: await listen(server), server }
}

const item = (n: number, extra: Record<string, unknown> = {}) => ({ Id: id(n), Type: 'Movie', Path: `/movies/m${n}.mkv`, RunTimeTicks: 6000e7, MediaStreams: [{ Type: 'Video', Height: 480 }], ...extra })

test('orphanClips: clips whose id Jellyfin no longer has, every tier; nothing for an empty list', () => {
  const names = [`${id(1)}.mp4`, `${id(1)}.720.mp4`, `${id(2)}.mp4`, `${id(2)}.1080.mp4`, 'manifest.json', '.manifest.json.tmp', 'notes.txt']
  assert.deepEqual(orphanClips(names, new Set([id(1)])), [`${id(2)}.mp4`, `${id(2)}.1080.mp4`])
  assert.deepEqual(orphanClips(names, new Set()), [])
})

test('mountFor: the deepest mount holding the file', () => {
  const mounts = [{ Destination: '/media' }, { Destination: '/media/movies/' }, { Destination: '/config' }]
  assert.equal(mountFor(mounts, '/media/movies/a.mkv')?.Destination, '/media/movies/')
  assert.equal(mountFor(mounts, '/media/tv/a.mkv')?.Destination, '/media')
  assert.equal(mountFor(mounts, '/mediax/a.mkv'), null)
})

test('pickJellyfin: by the connected name, the address, the published port, then the only Jellyfin image', () => {
  const c = (Id: string, name: string, image: string, ports: number[] = [], labels: Record<string, string> = {}) => ({ Id, Names: [`/${name}`], Image: image, State: 'running', Status: '', Labels: labels, Ports: ports.map((p) => ({ PrivatePort: 8096, PublicPort: p, Type: 'tcp' })) })
  // The maintainer's NAS: TrueNAS's Jellyfin publishes 8096; another Finesse's bundle Jellyfin sits beside it.
  const nas = [c('jf', 'ix-jellyfin-jellyfin-1', 'jellyfin/jellyfin:10.11.11', [8096]), c('other', 'finesse-jellyfin', 'jellyfin/jellyfin:12', [], { 'finesse.managed': 'true', 'finesse.instance': 'someone-else' }), c('me', 'ix-finesse-finesse-1', 'ghcr.io/coffeecc/finesse:3.2.6', [30500])]
  assert.deepEqual(pickJellyfin(nas, 'http://host.docker.internal:8096', { self: 'me', instance: 'mine' }), { id: 'jf', how: 'the container publishing port 8096' })
  assert.deepEqual(pickJellyfin(nas, 'http://jellyfin.lan', { known: 'ix-jellyfin-jellyfin-1' }), { id: 'jf', how: 'the container “ix-jellyfin-jellyfin-1”' })
  assert.deepEqual(pickJellyfin([c('a', 'jellyfin', 'lscr.io/linuxserver/jellyfin')], 'http://jellyfin:8096'), { id: 'a', how: 'the container “jellyfin”' })
  assert.deepEqual(pickJellyfin([{ ...c('a', 'jf', 'x/jellyfin'), ips: ['172.18.0.5'] }, c('b', 'web', 'nginx')], 'http://172.18.0.5:8096'), { id: 'a', how: 'the container at 172.18.0.5' })
  // Our own bundle Jellyfin is never "someone's own".
  assert.ok('reason' in pickJellyfin([c('ours', 'finesse-jellyfin', 'jellyfin/jellyfin', [], { 'finesse.managed': 'true', 'finesse.instance': 'mine' })], 'http://10.0.0.9:8096', { instance: 'mine' }))
  const two = pickJellyfin([c('a', 'jf1', 'jellyfin/jellyfin'), c('b', 'jf2', 'jellyfin/jellyfin')], 'http://192.168.1.4:8096')
  assert.ok('reason' in two && /More than one Jellyfin/.test(two.reason))
})

test('a run prunes clips of ids Jellyfin no longer has, rebuilds the manifests, and makes the missing ones', async () => {
  const previews = tmp()
  writeFileSync(join(previews, `${id(1)}.mp4`), 'keep')
  writeFileSync(join(previews, `${id(9)}.mp4`), 'old id')
  writeFileSync(join(previews, `${id(9)}.720.mp4`), 'old id')
  writeFileSync(join(previews, `.${id(3)}.mp4.part`), 'half')
  const jf = await jellyfin(() => ({ body: { Items: [item(1), item(2), item(3, { Path: undefined }), { Id: id(4), Type: 'Movie' }], TotalRecordCount: 4 } }))
  const s = store(previews)
  s.update((x) => {
    x.mode = 'adopt'
    x.jellyfin = { url: jf.url, apiKey: 'k', basePath: '' }
  })
  const asked: string[] = []
  const enc: ClipEncoder = {
    where: 'in a test',
    encode: async (args, out) => {
      asked.push(out)
      const f = join(tmp(), out)
      writeFileSync(f, 'clip')
      assert.ok(args.includes('/movies/m2.mkv'))
      return { file: f, output: '' }
    },
  }
  try {
    const clips = new ClipMaker(s, {} as StackHost, s.paths, () => true, { encoder: async () => enc })
    const st = await clips.run()
    assert.deepEqual(readdirSync(previews).filter((n) => n.endsWith('.mp4')).sort(), [`${id(1)}.mp4`, `${id(2)}.mp4`])
    assert.ok(!existsSync(join(previews, `.${id(3)}.mp4.part`)))
    assert.deepEqual(asked, [`${id(2)}.mp4`])
    assert.deepEqual(JSON.parse(readFileSync(join(previews, 'manifest.json'), 'utf8')).sort(), [id(1), id(2)])
    assert.deepEqual(JSON.parse(readFileSync(join(previews, 'manifest-hd.json'), 'utf8')), {})
    assert.equal(st.removed, 2)
    assert.equal(st.total, 2)
    assert.equal(st.made, 2)
    assert.equal(st.pending, 0)
    assert.equal(st.state, 'idle')
  } finally {
    jf.server.close()
  }
})

test('nothing is pruned when Jellyfin fails, lists part of the library, or lists nothing', async () => {
  const previews = tmp()
  writeFileSync(join(previews, `${id(9)}.mp4`), 'clip')
  let answer: { status?: number; body?: unknown } = { status: 500 }
  const jf = await jellyfin(() => answer)
  const s = store(previews)
  s.update((x) => {
    x.jellyfin = { url: jf.url, apiKey: 'k', basePath: '' }
  })
  const enc: ClipEncoder = { where: 'x', encode: async () => ({ file: null, output: 'no' }) }
  try {
    const clips = new ClipMaker(s, {} as StackHost, s.paths, () => true, { encoder: async () => enc })
    let st = await clips.run()
    assert.equal(st.state, 'blocked')
    assert.match(st.reason!, /couldn’t read the list of titles/)
    answer = { body: { Items: [item(1)], TotalRecordCount: 500 } }
    st = await clips.run()
    assert.match(st.reason!, /listed 1 of 500/)
    answer = { body: { Items: [], TotalRecordCount: 0 } }
    await clips.run()
    assert.ok(existsSync(join(previews, `${id(9)}.mp4`)))
  } finally {
    jf.server.close()
  }
})

test('a read-only previews folder, no encoder, or quiet-hours-only each say why', async () => {
  const jf = await jellyfin(() => ({ body: { Items: [item(1)], TotalRecordCount: 1 } }))
  try {
    const ro = tmp()
    chmodSync(ro, 0o555)
    const s1 = store(ro)
    s1.update((x) => void (x.jellyfin = { url: jf.url, apiKey: 'k', basePath: '' }))
    const root = process.getuid?.() === 0
    if (!root) {
      const st = await new ClipMaker(s1, {} as StackHost, s1.paths, () => true).run()
      assert.equal(st.state, 'blocked')
      assert.match(st.reason!, /can’t write to its previews folder/)
    }
    chmodSync(ro, 0o755)

    const s2 = store(tmp())
    s2.update((x) => {
      x.mode = 'adopt'
      x.jellyfin = { url: jf.url, apiKey: 'k', basePath: '' }
    })
    const none = await new ClipMaker(s2, {} as StackHost, s2.paths, () => true).run()
    assert.equal(none.state, 'blocked')
    assert.match(none.reason!, /need Jellyfin in Docker/)
    assert.equal(none.pending, 1)

    const night = await new ClipMaker(s2, {} as StackHost, s2.paths, () => true, { waitFor: () => 'Clips are made between 1 and 6 am.' }).run()
    assert.equal(night.state, 'idle')
    assert.equal(night.reason, 'Clips are made between 1 and 6 am.')

    s2.update((x) => void (x.previews = { enabled: false }))
    assert.equal((await new ClipMaker(s2, {} as StackHost, s2.paths, () => true).run()).state, 'off')
  } finally {
    jf.server.close()
  }
})

test('adopt: ffmpeg runs in a throwaway container from Jellyfin’s image, library read-only, lowest priority; the clip lands in Finesse’s folder', async () => {
  const fd = await fakeDocker(
    [
      { id: 'jf', name: 'ix-jellyfin-jellyfin-1', image: 'jellyfin/jellyfin:10.11.11', ports: { '8096/tcp': '8096' }, user: '568:568', mounts: [{ Source: '/mnt/HDDs/Movies', Destination: '/movies' }, { Source: '/mnt/apps/jellyfin', Destination: '/config' }] },
      { id: 'me', name: 'ix-finesse-finesse-1', image: 'ghcr.io/coffeecc/finesse:3.2.6', ports: { '8080/tcp': '30500' } },
    ],
    { file: (body, path) => (body.Labels['finesse.service'] === 'clip' && path.startsWith('/tmp/') ? 'mp4 bytes' : undefined) },
  )
  const previews = tmp()
  const s = store(previews)
  s.update((x) => {
    x.mode = 'adopt'
    x.jellyfin = { url: 'http://host.docker.internal:8096', apiKey: 'k', basePath: '' }
  })
  try {
    const docker = new Docker(fd.socket)
    const jf = await findJellyfin(docker, s.get(), 'me')
    assert.ok(!('reason' in jf))
    assert.equal(jf.name, 'ix-jellyfin-jellyfin-1')
    const enc = adoptEncoder(docker, jf, '/usr/lib/jellyfin-ffmpeg/ffmpeg', previews)
    const r = await enc.encode(['-i', '/movies/A (2020)/a.mkv', '-t', '20'], `${id(1)}.mp4`, '/movies/A (2020)/a.mkv')
    assert.ok(r.file)
    assert.equal(readFileSync(r.file!, 'utf8'), 'mp4 bytes')
    const [name, body] = Object.entries(fd.created)[0]!
    assert.match(name, /^finesse-clip-/)
    assert.equal(body.Image, 'jellyfin/jellyfin:10.11.11')
    assert.equal(body.User, '568:568')
    assert.deepEqual(body.HostConfig.Binds, ['/mnt/HDDs/Movies:/movies:ro'])
    assert.equal(body.HostConfig.NetworkMode, 'none')
    assert.equal(body.HostConfig.CpuShares, 2)
    assert.equal(body.Labels['finesse.managed'], 'true')
    assert.match(body.Cmd[2], /nice -n 19 '\/usr\/lib\/jellyfin-ffmpeg\/ffmpeg'/)
    // Jellyfin's own container: looked at, never touched.
    assert.ok(!fd.calls.some((c) => / (jf|ix-jellyfin-jellyfin-1)$/.test(c)), fd.calls.join('\n'))
    assert.ok(fd.calls.some((c) => c.startsWith('remove finesse-clip-')))
    // A title outside Jellyfin's folders isn't attempted.
    const outside = await enc.encode([], `${id(2)}.mp4`, '/elsewhere/b.mkv')
    assert.equal(outside.file, null)
    assert.equal(Object.keys(fd.created).length, 1)
  } finally {
    await fd.close()
  }
})

test('adopt with no Jellyfin container to be found says why', async () => {
  const fd = await fakeDocker([{ id: 'x', name: 'nginx', image: 'nginx' }])
  const s = store(tmp())
  s.update((x) => {
    x.mode = 'adopt'
    x.jellyfin = { url: 'http://192.168.1.50:8096', apiKey: 'k', basePath: '' }
  })
  try {
    const r = await findJellyfin(new Docker(fd.socket), s.get())
    assert.ok('reason' in r && /can’t find Jellyfin’s container/.test(r.reason))
  } finally {
    await fd.close()
  }
})
