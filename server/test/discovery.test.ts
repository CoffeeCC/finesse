// One title, in the library or requestable (src/lib/discovery.ts): matched by TMDb/TVDb id, and
// only by title + year when ids are missing.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSameTitle, lookupTitles, matchesTerm, mergeTitles } from '../../src/lib/discovery.ts'

const film = { Id: 'a', Type: 'Movie', Name: 'The Red Turtle', ProductionYear: 2016, ProviderIds: { Tmdb: '337703' } }

test('ids decide when both sides have them, whatever the names say', () => {
  assert.ok(isSameTitle(film, { kind: 'movie', title: 'La Tortue rouge', year: 2016, tmdbId: 337703 }))
  assert.ok(!isSameTitle(film, { kind: 'movie', title: 'The Red Turtle', year: 2016, tmdbId: 1 }), 'same name, other film')
  assert.ok(!isSameTitle(film, { kind: 'series', title: 'The Red Turtle', tvdbId: 5 }), 'a film is never a show')
  const show = { Id: 's', Type: 'Series', Name: 'Pioneer One', ProductionYear: 2010, ProviderIds: { Tvdb: '170551', Tmdb: '35811' } }
  assert.ok(isSameTitle(show, { kind: 'series', title: 'Pioneer One', tvdbId: 170551 }))
  assert.ok(!isSameTitle(show, { kind: 'series', title: 'Pioneer One', tvdbId: 9 }))
  // A library show with only a TMDb id still matches a Sonarr result that has one.
  assert.ok(isSameTitle({ ...show, ProviderIds: { Tmdb: '35811' } }, { kind: 'series', title: 'Pioneer 1', tvdbId: 170551, tmdbId: 35811 }))
})

test('without ids: the same title (spelling-insensitive) and year', () => {
  const bare = { Id: 'b', Type: 'Movie', Name: 'Amélie & Friends', ProductionYear: 2001 }
  assert.ok(isSameTitle(bare, { kind: 'movie', title: 'Amelie and Friends', year: 2001, tmdbId: 1 }))
  assert.ok(!isSameTitle(bare, { kind: 'movie', title: 'Amelie and Friends', year: 2002, tmdbId: 1 }))
  assert.ok(isSameTitle({ ...bare, ProductionYear: null }, { kind: 'movie', title: 'Amélie & Friends', year: 2002 }))
})

test('one list: the library first, then what can be requested, never the same title twice', () => {
  const lib = [
    film,
    { Id: 'e', Type: 'Episode', Name: 'The Red Turtle', ProductionYear: 2016 },
    { Id: 'n', Type: 'Movie', Name: 'Turtle Island', ProductionYear: 2020 }, // no ids in Jellyfin
  ]
  const req = [
    { kind: 'movie' as const, id: 0, hasFile: false, title: 'La Tortue rouge', year: 2016, tmdbId: 337703 }, // = film, by id
    { kind: 'movie' as const, id: 0, hasFile: false, title: 'Turtle Island', year: 2020, tmdbId: 5 }, // = n, by name + year
    { kind: 'movie' as const, id: 0, hasFile: false, title: 'Turtle Power', year: 2009, tmdbId: 6 },
    { kind: 'movie' as const, id: 9, hasFile: true, title: 'Turtles All The Way', year: 2011, tmdbId: 7 }, // on disk, not scanned yet
    { kind: 'series' as const, id: 3, hasFile: false, title: 'Turtle Tales', year: 2001, tvdbId: 8 }, // requested, still coming
    { kind: 'artist' as const, id: 0, hasFile: false, title: 'The Turtles' },
  ]
  const merged = mergeTitles(lib, req)
  assert.deepEqual(
    merged.map((e) => (e.source === 'library' ? `lib:${e.item.Id}` : `req:${e.r.title}`)),
    ['lib:a', 'lib:e', 'lib:n', 'req:Turtle Power', 'req:Turtle Tales'],
  )
  assert.equal(mergeTitles(lib, req, 1).filter((e) => e.source === 'request').length, 1)
  // Nothing in the library: the requestable titles are the list.
  assert.deepEqual(mergeTitles([], req.slice(2, 3)).map((e) => e.source), ['request'])
})

// ---------- matchesTerm: junk from fuzzy lookups drops out ----------

test('a lookup result is kept when the query is in its title', () => {
  assert.ok(matchesTerm(['The Matrix'], 'matrix'))
  assert.ok(matchesTerm(['The Matrix Reloaded'], 'matrix rel'), 'still typing')
  assert.ok(matchesTerm(['The Lord of the Rings: The Return of the King'], 'lord of the rings'))
  assert.ok(matchesTerm(['Spider-Man: No Way Home'], 'spiderman'), 'written without the hyphen')
  assert.ok(matchesTerm(['Amélie'], 'amelie'), 'accents')
  assert.ok(matchesTerm(['Dune'], 'dune 1984'), 'a year in the query needn’t match')
  assert.ok(matchesTerm(['Interstellar'], 'intersteller'), 'one typo in a longer word')
  assert.ok(matchesTerm(['Fast & Furious'], 'fast and furious'))
  assert.ok(matchesTerm(['It'], 'it'))
})

test('unrelated results from a fuzzy lookup drop out', () => {
  assert.equal(matchesTerm(['The Matrix'], 'zxqvbnm'), false)
  assert.equal(matchesTerm(['Mean Girls', 'Bean'], 'qwertyuiop'), false)
  assert.equal(matchesTerm(['Matrix'], 'matrix revolutions'), false, 'every word has to be there')
  assert.equal(matchesTerm(['Cars'], 'scar'), false, 'short words get no typos')
  assert.equal(matchesTerm(['Mean Girls'], 'bean'), false)
  assert.ok(matchesTerm(['Bean'], 'bean'))
})

test('alternate and original titles count, and id lookups keep everything', () => {
  const heist = { title: 'Money Heist', raw: { alternateTitles: [{ title: 'La casa de papel' }], originalTitle: 'La casa de papel' } }
  assert.ok(matchesTerm(lookupTitles(heist), 'casa de papel'))
  assert.ok(matchesTerm(['The Matrix'], 'tmdb:603'))
  assert.ok(matchesTerm(['The Matrix'], 'tt0133093'))
  assert.ok(matchesTerm(['Anything'], '   '))
})
