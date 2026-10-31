// One title, in the library or requestable (src/lib/discovery.ts): matched by TMDb/TVDb id, and
// only by title + year when ids are missing.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSameTitle } from '../../src/lib/discovery.ts'

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
