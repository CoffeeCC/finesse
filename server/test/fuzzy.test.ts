// Search that forgives typos (src/lib/fuzzy.ts).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fuzzyFind, fuzzyScore, plain, slips } from '../../src/lib/fuzzy.ts'

const TITLES = ['Harbour Lights', 'Glass Harbor', 'The Night Shift', 'Kestrel', 'The Orchard', 'Paper Lanterns', 'Amélie', 'Blade Runner 2049', 'Up', 'It']

test('titles are compared without case, accents, punctuation or a leading "the"', () => {
  assert.equal(plain('The Night-Shift!'), 'night shift')
  assert.equal(plain('Amélie'), 'amelie')
  assert.equal(plain('Fast & Furious'), 'fast and furious')
})

test('slips counts wrong, missing, extra and swapped letters', () => {
  assert.equal(slips('harbur', 'harbour', 2), 1)
  assert.equal(slips('lihgts', 'lights', 2), 1)
  assert.equal(slips('kestrel', 'kestrel', 2), 0)
  assert.equal(slips('abc', 'xyz', 1), 2)
})

test('exact pieces beat typo matches', () => {
  assert.equal(fuzzyScore('Kestrel', 'kestrel'), 100)
  assert.ok(fuzzyScore('Harbour Lights', 'harb') > fuzzyScore('Glass Harbor', 'harb'))
  assert.ok(fuzzyScore('Glass Harbor', 'harbor') > fuzzyScore('Harbour Lights', 'harbor'))
})

test('typos still find the title', () => {
  assert.deepEqual(fuzzyFind(TITLES, 'harbur lihgts', (t) => t), ['Harbour Lights'])
  assert.deepEqual(fuzzyFind(TITLES, 'kestral', (t) => t), ['Kestrel'])
  assert.deepEqual(fuzzyFind(TITLES, 'amelie', (t) => t), ['Amélie'])
  assert.deepEqual(fuzzyFind(TITLES, 'blade runer', (t) => t), ['Blade Runner 2049'])
  assert.equal(fuzzyFind(TITLES, 'night shfit', (t) => t)[0], 'The Night Shift')
})

test('an unfinished last word matches as you type', () => {
  assert.equal(fuzzyFind(TITLES, 'paper lan', (t) => t)[0], 'Paper Lanterns')
  assert.equal(fuzzyFind(TITLES, 'papr lant', (t) => t)[0], 'Paper Lanterns')
})

test('nonsense, and near-misses on very short words, find nothing', () => {
  assert.deepEqual(fuzzyFind(TITLES, 'zzzqq', (t) => t), [])
  assert.deepEqual(fuzzyFind(TITLES, 'ut', (t) => t), [])
  assert.deepEqual(fuzzyFind(TITLES, 'x', (t) => t), [])
})
