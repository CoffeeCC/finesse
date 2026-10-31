// After a request, every cached list that shows the title agrees it's requested
// (src/lib/requestState.ts, used by api/queries.ts noteRequested), and one title is one request.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markRequested, requestKey, sameArrTitle, type RequestableLike } from '../../src/lib/requestState.ts'

const turtle: RequestableLike = { kind: 'movie', id: 0, title: 'The Red Turtle', year: 2016, tmdbId: 337703, monitored: false }

test('the title just requested reads as requested in search, Discover and its page', () => {
  const search = [turtle, { ...turtle, title: 'Other', tmdbId: 1 }]
  const after = search.map((x) => markRequested(x, turtle, 42))
  assert.equal(after[0]!.id, 42)
  assert.equal(after[0]!.monitored, true)
  assert.equal(after[1], search[1], 'other titles are left alone')
  const discover = { ...turtle, existing: false, sections: ['popular'] }
  const d = markRequested(discover, turtle, 42)
  assert.equal(d.existing, true)
  assert.deepEqual(d.sections, ['popular'])
})

test('a title the app already had keeps its id; no id from the app changes nothing until the refetch', () => {
  assert.equal(markRequested({ ...turtle, id: 7 }, turtle, 42).id, 7)
  const same = { ...turtle }
  assert.equal(markRequested(same, turtle, 0), same)
})

test('matching: by TMDb / TVDb / MusicBrainz id, else title and year', () => {
  assert.ok(sameArrTitle(turtle, { ...turtle, title: 'La Tortue rouge' }))
  assert.ok(!sameArrTitle(turtle, { ...turtle, kind: 'series' }))
  const show: RequestableLike = { kind: 'series', id: 0, title: 'Show', tvdbId: 5, monitored: false }
  assert.ok(!sameArrTitle(show, { ...show, tvdbId: 6 }))
  const artist: RequestableLike = { kind: 'artist', id: 0, title: 'Band', monitored: false, raw: { foreignArtistId: 'mb-1' } }
  assert.ok(sameArrTitle(artist, { ...artist, title: 'The Band' }))
  assert.ok(!sameArrTitle(artist, { ...artist, raw: { foreignArtistId: 'mb-2' } }))
  const bare: RequestableLike = { kind: 'movie', id: 0, title: 'X', year: 2001, monitored: false }
  assert.ok(sameArrTitle(bare, { ...bare }))
  assert.ok(!sameArrTitle(bare, { ...bare, year: 2002 }))
})

test('one key per title, so a second tap joins the first request', () => {
  assert.equal(requestKey(turtle), requestKey({ ...turtle, overview: 'x' } as RequestableLike))
  assert.notEqual(requestKey(turtle), requestKey({ ...turtle, tmdbId: 2 }))
})
