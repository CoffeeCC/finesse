// The data folder as the apps name it: /data in Docker, the real folder on Windows.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromApp, hostToApp, toApp } from '../src/stack/apppaths.ts'

const withHost = (native: boolean, fn: () => void) => {
  const was = process.env.FINESSE_HOST
  if (native) process.env.FINESSE_HOST = 'native'
  else delete process.env.FINESSE_HOST
  try {
    fn()
  } finally {
    if (was === undefined) delete process.env.FINESSE_HOST
    else process.env.FINESSE_HOST = was
  }
}

test('Docker: the apps see /data', () =>
  withHost(false, () => {
    assert.equal(toApp('/srv/finesse', 'media/movies'), '/data/media/movies')
    assert.equal(hostToApp('/srv/finesse', '/srv/finesse/media/tv/Show'), '/data/media/tv/Show')
    assert.equal(fromApp('/srv/finesse', '/data/media/tv/Show'), '/srv/finesse/media/tv/Show')
    assert.equal(fromApp('/srv/finesse', '/config/x'), null)
    assert.equal(fromApp('/srv/finesse', '/data/media/../../etc'), null)
  }))

test('Windows: the apps see the real folder, and nothing outside it counts', () =>
  withHost(true, () => {
    assert.equal(toApp('/srv/finesse', 'media/movies'), '/srv/finesse/media/movies')
    assert.equal(hostToApp('/srv/finesse', '/srv/finesse/media/tv/Show'), '/srv/finesse/media/tv/Show')
    assert.equal(fromApp('/srv/finesse', '/srv/finesse/media/tv/Show'), '/srv/finesse/media/tv/Show')
    assert.equal(fromApp('/srv/finesse', '/srv/finesse-other/media'), null)
    assert.equal(fromApp('/srv/finesse', '/srv/finesse/media/../../etc'), null)
    assert.equal(fromApp('/srv/finesse', undefined), null)
  }))
