import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import { test } from 'node:test'
import { Arr, LANGUAGE_BLOCK, LANGUAGE_PREFER, wireLanguages } from '../src/stack/wire.ts'
import { listen } from './helpers.ts'

// A fake Sonarr/Radarr: just the custom format and quality profile endpoints,
// shaped like the real v3 API (checked against Sonarr 4 and Radarr 6).
type Cf = { id: number; name: string; specifications: { implementation: string; negate: boolean; required: boolean; fields: { name: string; value: unknown }[] }[] }
type Profile = { id: number; name: string; language?: { id: number; name: string }; formatItems: { format: number; score: number }[]; minFormatScore: number }

async function fakeArr(profiles: Profile[]) {
  const state = { cfs: [] as Cf[], profiles, writes: [] as string[], nextId: 1 }
  const schema = [
    {
      implementation: 'LanguageSpecification',
      implementationName: 'Language',
      negate: false,
      required: false,
      fields: [
        { name: 'value', value: 0, type: 'select', selectOptions: [['Original', -2], ['Unknown', 0], ['English', 1], ['German', 4], ['Japanese', 8], ['Portuguese (Brazil)', 30]].map(([name, value]) => ({ name, value })) },
        { name: 'exceptLanguage', value: false, type: 'checkbox' },
      ],
    },
  ]
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  }
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').replace(/^\/api\/v3/, '').split('?')[0]!
    const send = (v: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v))
    if (req.method !== 'GET') state.writes.push(`${req.method} ${path}`)
    let m: RegExpMatchArray | null
    if (req.method === 'GET' && path === '/customformat/schema') return send(schema)
    if (req.method === 'GET' && path === '/customformat') return send(state.cfs)
    if (req.method === 'POST' && path === '/customformat') {
      const cf = { ...(await read(req)), id: state.nextId++ }
      state.cfs.push(cf)
      // Like the real apps: a new format joins every profile at score 0.
      for (const p of state.profiles) p.formatItems.push({ format: cf.id, score: 0 })
      return send(cf)
    }
    if ((m = path.match(/^\/customformat\/(\d+)$/))) {
      const i = state.cfs.findIndex((c) => c.id === Number(m![1]))
      if (req.method === 'PUT') state.cfs[i] = await read(req)
      if (req.method === 'DELETE') state.cfs.splice(i, 1)
      return send({})
    }
    if (req.method === 'GET' && path === '/qualityprofile') return send(state.profiles)
    if (req.method === 'PUT' && (m = path.match(/^\/qualityprofile\/(\d+)$/))) {
      const i = state.profiles.findIndex((p) => p.id === Number(m![1]))
      state.profiles[i] = await read(req)
      return send(state.profiles[i])
    }
    res.writeHead(404).end()
  })
  const url = await listen(server)
  return { arr: new Arr(url, 'key', 'v3'), state, close: () => server.close() }
}

const profile = (id: number, name: string, language?: string): Profile => ({
  id,
  name,
  formatItems: [],
  minFormatScore: 0,
  ...(language ? { language: { id: language === 'Original' ? -2 : 3, name: language } } : {}),
})
const rule = (cfs: Cf[], name: string) =>
  cfs.find((c) => c.name === name)?.specifications.map((s) => `${s.negate ? 'not ' : ''}${s.fields.find((f) => f.name === 'value')!.value}${s.required ? '!' : ''}`)
const scores = (p: Profile, cfs: Cf[]) =>
  Object.fromEntries(p.formatItems.map((i) => [cfs.find((c) => c.id === i.format)?.name ?? i.format, i.score]))

test('Sonarr: blocks releases in neither the original language nor the household’s, prefers the original', async () => {
  const f = await fakeArr([profile(1, 'HD-1080p'), profile(2, 'Any')])
  try {
    await wireLanguages(f.arr, 'sonarr', 'en', () => {})
    // Known language, not original, not English → blocked. Untagged releases pass.
    assert.deepEqual(rule(f.state.cfs, LANGUAGE_BLOCK), ['not -2!', 'not 1!', 'not 0!'])
    assert.deepEqual(rule(f.state.cfs, LANGUAGE_PREFER), ['-2'])
    for (const p of f.state.profiles) assert.deepEqual(scores(p, f.state.cfs), { [LANGUAGE_PREFER]: 10, [LANGUAGE_BLOCK]: -10000 })
    assert.equal(f.state.profiles[0]!.minFormatScore, 0)
  } finally {
    f.close()
  }
})

test('re-running changes nothing', async () => {
  const f = await fakeArr([profile(1, 'HD-1080p', 'Original')])
  try {
    await wireLanguages(f.arr, 'radarr', 'en', () => {})
    const first = f.state.writes.length
    assert.ok(first > 0)
    await wireLanguages(f.arr, 'radarr', 'en', () => {})
    assert.equal(f.state.writes.length, first, `second run wrote: ${f.state.writes.slice(first).join(', ')}`)
  } finally {
    f.close()
  }
})

test('Radarr: its "Original only" default becomes "Any" (the rule decides), a language someone chose is kept', async () => {
  const f = await fakeArr([profile(1, 'HD-1080p', 'Original'), profile(2, 'French films', 'French')])
  try {
    await wireLanguages(f.arr, 'radarr', 'en', () => {})
    assert.deepEqual(f.state.profiles[0]!.language, { id: -1, name: 'Any' })
    assert.deepEqual(f.state.profiles[1]!.language, { id: 3, name: 'French' })
  } finally {
    f.close()
  }
})

test('regional setup languages map to the apps’ names', async () => {
  const br = await fakeArr([profile(1, 'HD-1080p')])
  const at = await fakeArr([profile(1, 'HD-1080p')])
  try {
    await wireLanguages(br.arr, 'sonarr', 'pt-BR', () => {})
    assert.deepEqual(rule(br.state.cfs, LANGUAGE_BLOCK), ['not -2!', 'not 30!', 'not 0!'])
    await wireLanguages(at.arr, 'sonarr', 'de-AT', () => {})
    assert.deepEqual(rule(at.state.cfs, LANGUAGE_BLOCK), ['not -2!', 'not 4!', 'not 0!'])
  } finally {
    br.close()
    at.close()
  }
})

test('a new household language updates the rule in place', async () => {
  const f = await fakeArr([profile(1, 'HD-1080p')])
  try {
    await wireLanguages(f.arr, 'sonarr', 'en', () => {})
    await wireLanguages(f.arr, 'sonarr', 'ja', () => {})
    assert.equal(f.state.cfs.filter((c) => c.name === LANGUAGE_BLOCK).length, 1)
    assert.deepEqual(rule(f.state.cfs, LANGUAGE_BLOCK), ['not -2!', 'not 8!', 'not 0!'])
  } finally {
    f.close()
  }
})

test('a language the apps don’t know: only the preference, never a block that would stop dubs', async () => {
  const f = await fakeArr([profile(1, 'HD-1080p')])
  try {
    await wireLanguages(f.arr, 'sonarr', 'en', () => {})
    await wireLanguages(f.arr, 'sonarr', 'xx', () => {})
    assert.equal(rule(f.state.cfs, LANGUAGE_BLOCK), undefined)
    assert.deepEqual(rule(f.state.cfs, LANGUAGE_PREFER), ['-2'])
  } finally {
    f.close()
  }
})
