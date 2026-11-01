// A four-part release version ("3.2.6.1") works everywhere Finesse reads one: the server's update
// checks, the image tag, the Windows asset, the TV's .ipk version (three numbers, as webOS demands)
// and the TV's launch script, which picks a staged update only when it's newer.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cmpVersion } from '../src/http/static.ts'
import { imageFor } from '../src/stack/selfupdate.ts'
import { windowsAsset } from '../src/stack/winupdate.ts'
import { webFits } from '../src/update.ts'
import { appinfoVersion } from '../../webos/version.mjs'

const root = join(import.meta.dirname, '..', '..')

test('server: 3.2.6.1 is newer than 3.2.6 and older than 3.2.7, and runs with a 3.2 server', () => {
  assert.equal(cmpVersion('3.2.6.1', '3.2.6'), 1)
  assert.equal(cmpVersion('v3.2.6.1', '3.2.6.0'), 1)
  assert.equal(cmpVersion('3.2.6', '3.2.6.1'), -1)
  assert.equal(cmpVersion('3.2.6.1', '3.2.7'), -1)
  assert.equal(cmpVersion('3.2.6.10', '3.2.6.9'), 1)
  assert.equal(webFits('3.2.6.1', '3.2.6'), true)
  assert.equal(webFits('3.3.0', '3.2.6.1'), false)
})

test('server: the image tag and the Windows asset carry the whole version', () => {
  assert.equal(imageFor('ghcr.io/coffeecc/finesse:3.2.6', '3.2.6.1'), 'ghcr.io/coffeecc/finesse:3.2.6.1')
  assert.equal(windowsAsset('3.2.6.1'), 'finesse-windows-3.2.6.1-x64.zip')
})

test('server: the web build asset of a four-part release is found', () => {
  const src = readFileSync(join(root, 'server', 'src', 'update.ts'), 'utf8')
  const m = /const WEB_ASSET_RE = (\/.+\/)\n/.exec(src)
  assert.ok(m)
  const re = new Function(`return ${m![1]}`)() as RegExp
  assert.equal(re.exec('finesse-web-3.2.6.1.tar.gz')?.[1], '3.2.6.1')
  assert.equal(re.exec('finesse-web-3.2.6.tar.gz')?.[1], '3.2.6')
})

test('webOS: the .ipk gets three numbers, as LG requires', () => {
  assert.equal(appinfoVersion('3.2.6.1'), '3.2.6')
  assert.equal(appinfoVersion('3.2.6'), '3.2.6')
  assert.equal(appinfoVersion('v3.2'), '3.2.0')
  assert.equal(appinfoVersion('3.02.6'), '3.2.6')
  assert.equal(appinfoVersion('3.2.6-beta'), '0.0.0')
})

test('webOS: the launch script runs a staged 3.2.6.1 over a baked 3.2.6', () => {
  const boot = readFileSync(join(root, 'webos', 'bootstrap', 'boot.js'), 'utf8')
  const m = /function cmp\(a, b\) \{[\s\S]*?\n {2}\}\n/.exec(boot)
  assert.ok(m, 'cmp() in boot.js')
  const cmp = new Function(`${m![0]}; return cmp`)() as (a: string, b: string) => number
  assert.equal(cmp('3.2.6.1', '3.2.6'), 1)
  assert.equal(cmp('3.2.6', '3.2.6.1'), -1)
  assert.equal(cmp('3.2.6', '3.2.6'), 0)
  assert.equal(cmp('3.3.0', '3.2.6.1'), 1)
})

test('Windows Setup accepts a four-part VERSION file', () => {
  const engine = readFileSync(join(root, 'windows', 'installer', 'Engine.cs'), 'utf8')
  const m = /Regex\.IsMatch\(version, @"([^"]+)"\)/.exec(engine)
  assert.ok(m)
  const re = new RegExp(m![1]!)
  assert.ok(re.test('3.2.6.1'))
  assert.ok(re.test('3.2.6'))
  assert.ok(!re.test('3.2'))
  assert.ok(!re.test('3.2.6.1.2'))
})
