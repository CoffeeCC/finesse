// The Finesse tour — TV segment: the TV browser build, driven only by the
// remote's arrows, OK and Back (shown as key hints). node tv.mjs <outdir> [--dry]
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, newStage, Recorder, director, sleep, say, voWait, sfx, cueTimes } from './lib.mjs'

const OUT = process.argv[2]
const DRY = process.argv.includes('--dry')
mkdirSync(OUT, { recursive: true })
import { APP, PASSWORD as PW } from './config.mjs'

const b = await launch()
const { context, page } = await newStage(b, {
  userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager',
})
// TV-sized UI: the LG app's default 130% display size (Settings → Appearance).
await context.addInitScript(() => {
  try {
    const p = JSON.parse(localStorage.getItem('finesse.prefs') || '{}')
    localStorage.setItem('finesse.prefs', JSON.stringify({ ...p, uiScale: 1.3 }))
  } catch {}
})
const d = director(page)
const rec = new Recorder(page, `${OUT}/frames`)
let shot = 0
if (DRY) {
  const cap = d.caption
  d.caption = async (t, s, ms) => {
    await cap(t, s, ms)
    await sleep(1400)
    await page.screenshot({ path: `${OUT}/cap-${String(++shot).padStart(2, '0')}.png` })
  }
}
const K = {
  up: () => d.key('ArrowUp', '↑'),
  down: () => d.key('ArrowDown', '↓'),
  left: () => d.key('ArrowLeft', '←'),
  right: () => d.key('ArrowRight', '→'),
  ok: (after = 900) => d.key('Enter', 'OK', null, after),
  back: (after = 1200) => d.key('Escape', '↩', 'Back', after),
}
const times = async (n, fn, gap = 650) => {
  for (let i = 0; i < n; i++) {
    await fn()
    await sleep(gap)
  }
}

/** Press arrows (shown on screen) until a card matching `name` has focus. */
async function steerTo(name) {
  for (let i = 0; i < 12; i++) {
    const move = await page.evaluate((src) => {
      const re = new RegExp(src)
      const a = document.activeElement
      const label = (el) => `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`
      if (a && re.test(label(a))) return null
      const ab = a?.getBoundingClientRect()
      if (!ab) return 'down'
      const cx = ab.x + ab.width / 2, cy = ab.y + ab.height / 2
      const cands = [...document.querySelectorAll('a,button')].filter((el) => re.test(label(el)) && el.getBoundingClientRect().width > 40)
      let best = null, bd = Infinity
      for (const el of cands) {
        const b = el.getBoundingClientRect()
        const d = Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy)
        if (d < bd) { bd = d; best = b }
      }
      if (!best) return null
      const dx = best.x + best.width / 2 - cx, dy = best.y + best.height / 2 - cy
      return Math.abs(dy) > 60 ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left'
    }, name.source)
    if (!move) return
    await K[move]()
    await sleep(700)
  }
}

// Sign in off camera.
await page.goto(`${APP}/login`)
await sleep(2500)
await page.getByRole('button', { name: /Watch as alex/ }).first().click()
await page.fill('input[type=password]', PW)
await page.keyboard.press('Enter')
await page.waitForURL(/\/finesse\/?$/, { timeout: 20000 })
await sleep(3500)
await d.hideCursor()
await page.evaluate(() => window.__tour?.card('On your TV', 'Finesse.', 'The LG TV app, or any TV’s web browser. Everything works with the remote.', null))
if (!DRY) await rec.start()
sfx('whoosh')
await say('On your TV|Finesse.')
await sleep(2000)
await voWait()
await page.evaluate(() => window.__tour?.uncard())
await sleep(900)

await d.caption('Made for the remote', 'Arrows move, OK selects. The top of the screen describes whatever you’re on.')
await sleep(1500)
await K.down()
await sleep(1000)
await times(2, K.right, 1300)
await K.down()
await sleep(1100)
await K.down()
await sleep(1100)
await steerTo(/Elephants Dream/)
await sleep(1200)

await d.caption('Open a title', 'OK opens it. Play, My List and the details are one press away.')
await K.ok(2800)
await K.down()
await sleep(1000)
await K.up()
await sleep(1000)

await d.caption('A player for the remote', 'Left and right skip; hold to go faster. OK pauses, Back leaves.')
await K.ok(4000)
await times(3, K.right, 700)
await sleep(2200)
await K.ok(1600)
await sleep(2200)
await K.ok(1600)
await K.back(1800)
await K.back(2000)

await d.caption('Install it on your LG TV', 'Install once from the release page; it updates itself after that. Other TVs can use their browser.')
await sleep(4200)
await d.clear()
await sleep(700)

if (!DRY) {
  await voWait()
  const r = await rec.stop()
  console.log(r)
  writeFileSync(`${OUT}/cues.json`, JSON.stringify(cueTimes(r.t0), null, 1))
}
else await page.screenshot({ path: `${OUT}/end.png` })
await b.close()
