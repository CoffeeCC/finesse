// README screenshots from the demo server → docs/media/*.jpg
import { mkdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { launch, newStage, sleep } from './lib.mjs'
import { APP, WIZ, PASSWORD, REPO, ids as demoIds, ff } from './config.mjs'
import { join } from 'node:path'

const OUT = join(REPO, 'docs/media')
mkdirSync(OUT, { recursive: true })
const ids = demoIds()
const PW = PASSWORD
const b = await launch()

async function signIn(page, tap = false) {
  await page.goto(`${APP}/login`)
  await sleep(2000)
  const btn = page.getByRole('button', { name: /Watch as alex/ }).first()
  await (tap ? btn.tap() : btn.click())
  await page.fill('input[type=password]', PW)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/finesse\/?$/, { timeout: 20000 })
  await sleep(3500)
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 })
const hideCursor = (page) => page.evaluate(() => window.__tour?.hideCursor())

// Desktop at 1600×900 (2× would be crisper but 4× the bytes).
{
  const { page } = await newStage(b, { width: 1600, height: 900 })
  await signIn(page)
  await hideCursor(page)
  await page.mouse.move(1500, 600)
  await sleep(2500)
  await shot(page, 'home')

  await page.goto(`${APP}/item/${ids['Sintel']}`)
  await page.getByText('A wandering warrior').first().waitFor()
  await sleep(4000)
  await shot(page, 'detail')

  await page.getByRole('link', { name: /^Play/ }).first().click()
  await sleep(9000)
  await page.mouse.move(800, 450)
  await sleep(300)
  await page.mouse.move(820, 460)
  await sleep(900)
  await shot(page, 'player')
  await page.getByRole('button', { name: 'Back' }).first().click()
  await sleep(1500)

  await page.goto(`${APP}/request?q=the%20iron%20giant`)
  await sleep(6000)
  await shot(page, 'request')

  await page.goto(`${APP}/music`)
  await page.getByText('Thing a Week Three').first().waitFor()
  await page.getByRole('link', { name: /Thing a Week Three/ }).first().click()
  await sleep(2000)
  await page.getByRole('button', { name: /Code Monkey/ }).first().click()
  await sleep(2500)
  await page.getByTitle('Open now playing').click()
  await sleep(9000)
  await shot(page, 'music')
  await page.getByRole('button', { name: 'Close now playing' }).first().click().catch(() => {})
  await page.getByRole('button', { name: 'Close player' }).first().click().catch(() => {})

  await page.goto(`${APP}/settings`)
  await sleep(1500)
  await page.getByRole('button', { name: /^Server/ }).first().click()
  await sleep(4000)
  await shot(page, 'system')

  // Setup page on the fresh wizard server.
  const code = execSync('docker exec finesse-wiz finesse setup-code').toString().trim()
  await page.goto(`${WIZ}/setup?code=${code}`)
  await page.getByText('Docker ', { exact: false }).first().waitFor({ timeout: 60000 })
  await sleep(2500)
  await shot(page, 'setup')
  await page.context().close()
}

// TV browser (1920×1080 → saved at 1600).
{
  const { page } = await newStage(b, { width: 1920, height: 1080, userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager' })
  await signIn(page)
  await hideCursor(page)
  for (const k of ['ArrowDown', 'ArrowRight', 'ArrowRight']) {
    await page.keyboard.press(k)
    await sleep(900)
  }
  await sleep(2500)
  await page.screenshot({ path: `${OUT}/tv-full.png` })
  ff(['-i', `${OUT}/tv-full.png`, '-vf', 'scale=1600:-1', '-q:v', '3', `${OUT}/tv.jpg`])
  rmSync(`${OUT}/tv-full.png`)
  await page.context().close()
}

// Phone (390×844 @2×).
{
  const { page } = await newStage(b, { width: 390, height: 844, dpr: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' })
  await signIn(page, true)
  await sleep(1500)
  await shot(page, 'phone')
  await page.context().close()
}
await b.close()
console.log('ok')
