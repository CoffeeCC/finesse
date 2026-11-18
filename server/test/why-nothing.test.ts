import assert from 'node:assert/strict'
import { test } from 'node:test'
import { explain, rankCopies, whyNothing, type CopyFacts } from '../../src/lib/whyNothing.ts'

const GB = 1e9
// What Radarr 6 said about a Japanese film when the household's profiles want English only.
const HELLS: CopyFacts[] = [
  { title: 'Hells.2008.BluRay.1080p.REMUX', size: 35.8 * GB, languages: ['Japanese'], rejections: ['English is wanted, but found Japanese', 'Remux-1080p is not wanted in profile'] },
  { title: 'Hells (2008) [Bluray-1080p]-LazyMux', size: 12.7 * GB, languages: ['Japanese'], rejections: ['English is wanted, but found Japanese'] },
  { title: 'Hells (2008) 1080p BRRip -YTS', size: 2.3 * GB, seeders: 9, languages: ['Japanese'], rejections: ['2.2 GB is smaller than minimum allowed 2.9 GB (for Hells)', 'English is wanted, but found Japanese'] },
  { title: 'Hells (2008) [1080p BluRay English/Japanese]', size: 31.8 * GB, seeders: 3, languages: ['English', 'Japanese'], rejections: ['29.6 GB is larger than maximum allowed 25.4 GB (for Hells)', 'Custom Formats Block: Non-English Release, Language: English have score -9900 below Movie\'s profile minimum 0'] },
  { title: 'Hells Angels [Movie] (2008) Rus', size: 1.7 * GB, seeders: 1, rejections: ['Unknown Movie. Unable to match to correct movie using release title.'] },
]

test('reasons in plain words', () => {
  assert.deepEqual(explain('English is wanted, but found Japanese'), { reason: 'language', text: 'In Japanese, and your settings want English' })
  assert.deepEqual(explain('29.6 GB is larger than maximum allowed 25.4 GB (for Hells)'), { reason: 'size', text: 'Bigger than your size limit (29.6 GB; the limit is 25.4 GB)' })
  assert.equal(explain('Custom Formats Block: Non-English Release, Foreign Language Block have score -20000 below Series profile minimum 0').reason, 'language')
  assert.equal(explain('Custom Formats x265 has score -500 below Movie\'s profile minimum 0').reason, 'rule')
  assert.deepEqual(explain('Bluray-1080p Remux is not wanted in profile'), { reason: 'quality', text: 'Bluray-1080p Remux isn’t a quality your settings allow' })
  assert.equal(explain('Not enough seeders: 0. Minimum seeders: 1').reason, 'seeders')
  assert.equal(explain('Existing file on disk meets quality cutoff: Bluray-1080p').reason, 'have')
  assert.equal(explain('Something new').text, 'Something new')
})

test('a foreign film behind English-only settings: says so, and points at the language setting', () => {
  const w = whyNothing(HELLS, 'English')
  assert.equal(w.found, 4, 'the Hells Angels result is something else')
  assert.equal(w.headline, 'Found 4 copies, but none fit your settings')
  assert.equal(w.lines[0], '4 are in Japanese, and your settings want English')
  assert.ok(w.lines.includes('2 are outside your size limits'))
  assert.equal(w.fix, 'language')
  assert.equal(whyNothing(HELLS).lines[0], '4 are in Japanese, and your settings want English', 'read from the reasons')
})

test('nothing out there yet, or something that fits', () => {
  const none = whyNothing([HELLS[4]!])
  assert.equal(none.found, 0)
  assert.match(none.lines[0]!, /^1 result was something else/)
  const ok = whyNothing([...HELLS, { title: 'Hells (2008) 1080p WEB', size: 8 * GB, rejections: [] }])
  assert.equal(ok.fine, 1)
  assert.equal(ok.fix, undefined)
})

test('size alone: the fix is the size setting', () => {
  const w = whyNothing([
    { title: 'a', size: 40 * GB, rejections: ['40 GB is larger than maximum allowed 25.4 GB (for X)'] },
    { title: 'b', size: 30 * GB, rejections: ['30 GB is larger than maximum allowed 25.4 GB (for X)'] },
  ])
  assert.equal(w.fix, 'size')
})

test('best copies first: fewest problems, then most sharing, never the other title', () => {
  const r = rankCopies(HELLS)
  assert.equal(r[r.length - 1]!.title, 'Hells Angels [Movie] (2008) Rus')
  assert.equal(r[0]!.title, 'Hells (2008) [Bluray-1080p]-LazyMux')
})
