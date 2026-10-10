// Prowlarr's own search sites: named, not typed in. Found in Prowlarr's list by name; one it doesn't list is a warning, not a crash.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wireProwlarr, type Arr } from '../src/stack/wire.ts'
import { checkIndexer } from '../src/setup/checks.ts'

type Thing = Record<string, any>

/** Just enough of Prowlarr: a list of saved things and a schema of what it can add. */
function fakeProwlarr(sites: { definitionName: string; name: string; implementation: string }[]) {
  const saved: Thing[] = []
  const schema: Thing[] = [
    { implementation: 'Torznab', definitionName: 'Generic Torznab', name: 'Generic Torznab', fields: [{ name: 'baseUrl' }, { name: 'apiKey' }] },
    ...sites.map((s) => ({ ...s, fields: [{ name: 'definitionFile', value: s.definitionName }] })),
  ]
  const prowlarr = {
    req: async () => ({}),
    async upsert(_kind: string, match: (t: Thing) => boolean, build: (schema: Thing[]) => Thing) {
      const next = build(schema)
      const old = saved.find(match)
      if (old) Object.assign(old, next)
      else saved.push({ ...next, id: saved.length + 1 })
      return 1
    },
  } as unknown as Arr
  return { prowlarr, saved }
}
const run = (prowlarr: Arr, indexers: Parameters<typeof wireProwlarr>[1]['indexers']) => wireProwlarr(prowlarr, { selfUrl: 'http://prowlarr:9696', apps: [], indexers }, () => {})

test('a built-in site is added by name, with nothing typed in', async () => {
  const { prowlarr, saved } = fakeProwlarr([{ definitionName: 'internetarchive', name: 'Internet Archive', implementation: 'Cardigann' }])
  const r = await run(prowlarr, [{ name: 'Internet Archive', kind: 'torznab', definition: 'internetarchive' }])
  assert.deepEqual(r.indexerErrors, [])
  assert.equal(saved.length, 1)
  assert.equal(saved[0]!.implementation, 'Cardigann')
  assert.equal(saved[0]!.name, 'Internet Archive')
  assert.equal(saved[0]!.enable, true)
})

test('names match however they are spelled', async () => {
  const { prowlarr, saved } = fakeProwlarr([{ definitionName: 'Internet Archive', name: 'Internet Archive', implementation: 'Cardigann' }])
  const r = await run(prowlarr, [{ name: 'Internet Archive', kind: 'torznab', definition: 'internet-archive' }])
  assert.deepEqual(r.indexerErrors, [])
  assert.equal(saved.length, 1)
})

test('a site this Prowlarr does not list is a warning, and the others still go in', async () => {
  const { prowlarr, saved } = fakeProwlarr([{ definitionName: 'internetarchive', name: 'Internet Archive', implementation: 'Cardigann' }])
  const r = await run(prowlarr, [
    { name: 'LinuxTracker', kind: 'torznab', definition: 'linuxtracker' },
    { name: 'Internet Archive', kind: 'torznab', definition: 'internetarchive' },
  ])
  assert.equal(r.indexerErrors.length, 1)
  assert.equal(r.indexerErrors[0]!.name, 'LinuxTracker')
  assert.match(r.indexerErrors[0]!.error, /doesn't list LinuxTracker/)
  assert.deepEqual(saved.map((s) => s.name), ['Internet Archive'])
})

test('running it again changes nothing', async () => {
  const { prowlarr, saved } = fakeProwlarr([{ definitionName: 'internetarchive', name: 'Internet Archive', implementation: 'Cardigann' }])
  const one = [{ name: 'Internet Archive', kind: 'torznab' as const, definition: 'internetarchive' }]
  await run(prowlarr, one)
  await run(prowlarr, one)
  assert.equal(saved.length, 1)
})

test('a typed-in indexer still goes in as a generic Torznab', async () => {
  const { prowlarr, saved } = fakeProwlarr([])
  const r = await run(prowlarr, [{ name: 'Mine', kind: 'torznab', url: 'https://mine.example/torznab/', apiKey: 'k' }])
  assert.deepEqual(r.indexerErrors, [])
  assert.equal(saved[0]!.implementation, 'Torznab')
  assert.equal(saved[0]!.fields.find((f: Thing) => f.name === 'baseUrl').value, 'https://mine.example/torznab')
})

test('testing a built-in site has nothing to try', async () => {
  const v = await checkIndexer({ name: 'Internet Archive', kind: 'torznab', definition: 'internetarchive' })
  assert.equal(v.ok, true)
  assert.match(v.message, /Prowlarr’s own sites/)
})
