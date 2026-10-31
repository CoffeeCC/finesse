// Next/previous episode in the player and episode labels (src/lib/episodes.ts): two copies of one
// episode are one step, not two, and missing numbers never show up as "S?:E?".

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adjacentEpisodes, episodeChip, episodeCode, type EpisodeLike } from '../../src/lib/episodes.ts'

const ep = (Id: string, s: number | undefined, e: number | undefined, extra: Partial<EpisodeLike> = {}): EpisodeLike => ({ Id, ParentIndexNumber: s, IndexNumber: e, ...extra })

test('two copies of E1 and one E2: Next Episode starts E2 from either copy', () => {
  const list = [ep('e1-long', 1, 1), ep('e1-short', 1, 1), ep('e2', 1, 2)]
  assert.equal(adjacentEpisodes(list, 'e1-long').next?.Id, 'e2')
  assert.equal(adjacentEpisodes(list, 'e1-short').next?.Id, 'e2')
  assert.equal(adjacentEpisodes(list, 'e1-short').prev, undefined)
  // Back from E2 goes to E1 (its first copy), once.
  assert.equal(adjacentEpisodes(list, 'e2').prev?.Id, 'e1-long')
  assert.equal(adjacentEpisodes(list, 'e2').next, undefined)
})

test('copies that aren’t next to each other still count once; seasons are crossed', () => {
  const list = [ep('s1e1', 1, 1), ep('s1e2', 1, 2), ep('s1e1-again', 1, 1), ep('s2e1', 2, 1)]
  assert.equal(adjacentEpisodes(list, 's1e1-again').next?.Id, 's1e2')
  assert.equal(adjacentEpisodes(list, 's1e2').next?.Id, 's2e1')
  assert.equal(adjacentEpisodes(list, 's2e1').prev?.Id, 's1e2')
})

test('missing and special episodes stay out of the main run', () => {
  const list = [ep('sp1', 0, 1), ep('e1', 1, 1), ep('e2', 1, 2, { LocationType: 'Virtual' }), ep('e3', 1, 3), ep('sp2', 0, 2)]
  assert.deepEqual(
    [adjacentEpisodes(list, 'e1').prev?.Id, adjacentEpisodes(list, 'e1').next?.Id],
    [undefined, 'e3'],
  )
  assert.equal(adjacentEpisodes(list, 'sp1').next?.Id, 'sp2')
})

test('episodes without numbers each stand alone, in list order', () => {
  const list = [ep('a', 1, undefined), ep('b', 1, undefined), ep('c', 1, 1)]
  assert.equal(adjacentEpisodes(list, 'a').next?.Id, 'b')
  assert.equal(adjacentEpisodes(list, 'b').next?.Id, 'c')
  assert.deepEqual(adjacentEpisodes(list, 'missing'), {})
})

test('labels: numbers when there are some, nothing made up when there aren’t', () => {
  assert.equal(episodeCode(ep('x', 1, 2)), 'S1:E2')
  assert.equal(episodeCode(ep('x', 1, 2, { IndexNumberEnd: 3 })), 'S1:E2–3')
  assert.equal(episodeCode(ep('x', 0, 3)), 'Special 3')
  assert.equal(episodeCode(ep('x', undefined, 4)), 'Episode 4')
  assert.equal(episodeCode(ep('x', 2, undefined)), '')
  assert.equal(episodeCode({}), '')
  assert.equal(episodeChip(ep('x', 1, 2)), 'S1 · E2')
  assert.equal(episodeChip({}), '')
  for (const label of [episodeCode({}), episodeChip({ ParentIndexNumber: 1 })]) assert.doesNotMatch(label, /\?|^0$/)
})
