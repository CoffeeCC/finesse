// The Finesse tour — phone segment. Records a 390×844 touch phone; captions are
// logged (not drawn) so compose.mjs can set them beside the phone.
// node phone.mjs <outdir> [--dry]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { launch, newStage, Recorder, director, sleep, K, say, voWait, sfx, cueTimes } from './lib.mjs'

const OUT = process.argv[2]
const DRY = process.argv.includes('--dry')
mkdirSync(OUT, { recursive: true })
import { APP, PASSWORD as PW } from './config.mjs'

const b = await launch()
const { page } = await newStage(b, {
  width: 430,
  height: 932,
  dpr: 1,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
})
const d = director(page)
const cdp = await page.context().newCDPSession(page)
const rec = new Recorder(page, `${OUT}/frames`)
const caps = []
let shot = 0
const caption = async (title, sub) => {
  await say(title)
  caps.push({ at: Date.now() / 1000, title, sub })
  if (DRY) {
    await sleep(1200)
    await page.screenshot({ path: `${OUT}/cap-${++shot}.png` })
  }
}
const clear = async () => {
  await voWait()
  caps.push({ at: Date.now() / 1000, title: null })
}

/** A finger tap: ripple where it lands, then a real touch. */
async function tap(loc, after = 700) {
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
  const bb = await loc.boundingBox({ timeout: 10000 })
  if (!bb) throw new Error(`nothing to tap: ${loc}`)
  const x = bb.x + bb.width / 2
  const y = bb.y + bb.height / 2
  await page.evaluate(([x, y]) => window.__tour?.ripple(x, y), [x, y])
  sfx('click')
  await page.touchscreen.tap(x, y)
  await sleep(after)
}
async function tapAt(x, y, after = 120) {
  await page.evaluate(([x, y]) => window.__tour?.ripple(x, y), [x, y])
  sfx('click')
  await page.touchscreen.tap(x, y)
  await sleep(after)
}
/** A thumb swipe: an eased scroll of whatever scrolls that way under the finger. */
async function swipe(x, y, dx, dy, ms = 900) {
  await page.evaluate(([x, y, dx, dy, ms]) => new Promise((done) => {
    const horiz = Math.abs(dx) > Math.abs(dy)
    let el = document.elementFromPoint(x, y)
    const ok = (e) => horiz
      ? e.scrollWidth > e.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowX)
      : e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)
    while (el && el !== document.body && !ok(el)) el = el.parentElement
    if (!el || el === document.body) el = document.scrollingElement
    const fx = el.scrollLeft, fy = el.scrollTop, t0 = performance.now()
    const ease = (t) => 1 - Math.pow(1 - t, 3)
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms)
      el.scrollTo({ left: fx + dx * ease(t), top: fy + dy * ease(t), behavior: 'instant' })
      if (t < 1) requestAnimationFrame(step)
      else done()
    }
    requestAnimationFrame(step)
  }), [x, y, dx, dy, ms])
}
const by = (role, name, opts) => page.getByRole(role, { name, ...opts }).first()

// Sign in off camera.
await page.goto(`${APP}/login`)
await sleep(2000)
await tap(by('button', /Watch as alex/), 400)
await page.fill('input[type=password]', PW)
await page.keyboard.press('Enter')
await page.waitForURL(/\/finesse\/?$/, { timeout: 20000 })
await sleep(3000)
await d.hideCursor()
if (!DRY) await rec.start(430, 932)

// 1. Home
await caption('Made for thumbs', 'The same Finesse on your phone. Add it to your home screen and it opens like an app.')
await sleep(3200)
await swipe(215, 660, 0, 560)
await sleep(1600)
await swipe(215, 660, 0, 460)
await sleep(1200)
// Flick a row sideways (whatever row is under the thumb).
await swipe(330, 620, 340, 0, 900)
await sleep(1400)

// 2. Search → a title
await caption('Search and tabs', 'Home, Search, Library and My List sit under your thumb.')
await tap(by('link', 'Search'), 900)
await d.type('sintel', 120)
await sleep(1800)
await tap(page.getByRole('button', { name: 'Details' }).or(page.getByRole('link', { name: 'Details' })).first(), 2400)
await caption('Every title, one tap to play', 'Previews, My List and “Play on another device” are right there.')
await sleep(2600)
await swipe(215, 660, 0, 320)
await sleep(1200)
await swipe(215, 440, 0, -320)
await sleep(600)

// 3. Player
await tap(page.getByRole('link', { name: /^Play/ }).first(), 1200)
await caption('Double-tap to skip', 'Tap for the controls. Double-tap the right side to jump 10 seconds ahead, the left side to go back.')
await sleep(2600)
await tapAt(215, 466, 1600)
await tapAt(352, 466, 90)
await tapAt(352, 466, 1400)
await tapAt(352, 466, 90)
await tapAt(352, 466, 1600)
await tapAt(78, 466, 90)
await tapAt(78, 466, 1800)
await tapAt(215, 466, 1200)
await tap(by('button', 'Back'), 1800)

// 4. My List
await caption('Pick up anywhere', 'My List, what you’ve watched and where you stopped follow you from the TV to your phone.')
await tap(by('link', 'My List'), 2600)
await swipe(215, 660, 0, 320)
await sleep(1800)
await tap(by('link', 'Home'), 1800)
await clear()
await sleep(600)

if (!DRY) {
  await voWait()
  const r = await rec.stop()
  writeFileSync(`${OUT}/cues.json`, JSON.stringify(cueTimes(r.t0), null, 1))
  console.log(r)
  writeFileSync(`${OUT}/captions.json`, JSON.stringify(caps.map((c) => ({ ...c, t: +((c.at - r.t0) / K).toFixed(2) })), null, 1))
} else {
  await page.screenshot({ path: `${OUT}/end.png` })
}
await b.close()
