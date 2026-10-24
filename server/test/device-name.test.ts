// How each device is named in Remote and "Play on…" (src/lib/deviceName.ts): TVs that run Android
// used to show up as an "Android tablet" (or phone).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deviceNameFor } from '../../src/lib/deviceName.ts'

const CHROME = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0'

test('TVs are named as TVs, even the ones that run Android', () => {
  const cases: [string, string][] = [
    [`Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) ${CHROME} Safari/537.36`, 'Shield TV'],
    [`Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7624; wv) ${CHROME} Mobile Safari/537.36`, 'Fire TV'],
    [`Mozilla/5.0 (Linux; Android 10; BRAVIA 4K UR3 Build/QTG3.200305.006.S292; wv) ${CHROME} Safari/537.36`, 'Sony TV'],
    [`Mozilla/5.0 (Linux; Android 12; Chromecast Build/STTE.230319.008; wv) ${CHROME} Safari/537.36`, 'Chromecast'],
    [`Mozilla/5.0 (Linux; Android 11; Android TV Build/RTT1.210713.001) ${CHROME} Safari/537.36`, 'Android TV'],
    [`Mozilla/5.0 (X11; Linux aarch64) ${CHROME} Safari/537.36 VIDAA/7.0(Hisense;SmartTV;65U8)`, 'Hisense TV'],
    [`Mozilla/5.0 (Linux; Tizen 6.5) ${CHROME} TV Safari/537.36`, 'Samsung TV'],
    [`Mozilla/5.0 (Web0S; Linux/SmartTV) ${CHROME} Safari/537.36 WebAppManager`, 'LG TV'],
    [`Mozilla/5.0 (Linux; U; Linux; NETTV/9.1.0 SmartTvA/3.0.0) ${CHROME} Safari/537.36`, 'Philips TV'],
  ]
  for (const [ua, name] of cases) assert.equal(deviceNameFor(ua), name, ua)
})

test('phones, tablets and computers keep their names', () => {
  assert.equal(deviceNameFor(`Mozilla/5.0 (Linux; Android 14; Pixel 8) ${CHROME} Mobile Safari/537.36`), 'Chrome on Android phone')
  assert.equal(deviceNameFor(`Mozilla/5.0 (Linux; Android 13; SM-X710) ${CHROME} Safari/537.36`), 'Chrome on Android tablet')
  assert.equal(deviceNameFor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone')
  assert.equal(deviceNameFor(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${CHROME} Safari/537.36 Edg/120.0.0.0`), 'Edge on Windows')
  assert.equal(deviceNameFor('anything', true), 'LG TV')
})
