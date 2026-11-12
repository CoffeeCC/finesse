// Shared capture setup for the Shorts: the repo's tour stage (cursor overlay, slow-mo, demo path/port masking)
// in a vertical-friendly 860x880 viewport, rendered at real 2x.
import { newStage, Recorder, director, sleep, K } from '../lib.mjs'
import { APP, PASSWORD, CHROME } from '../config.mjs'
import { chromium } from '../node_modules/playwright/index.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
export { sleep, K, APP, director }
export const VW = 860, VH = 880, DPR = 2
export async function stage() {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required', `--force-device-scale-factor=${DPR}`] })
  const { page, context } = await newStage(browser, { width: VW, height: VH, dpr: 1 })
  // Posters only: never load trailers.
  await context.route(/youtube\.com|youtube-nocookie|ytimg|googlevideo/, (r) => r.abort())
  return { browser, page, context }
}
export async function login(page) {
  await page.goto(`${APP}/login`)
  await page.getByRole('button', { name: /Watch as alex/ }).click()
  await page.fill('input[type=password]', PASSWORD)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/finesse\/?$/)
  await page.locator('[data-tile]').first().waitFor()
  await page.mouse.move(VW - 10, 200)
}
export function recorder(page, out) {
  mkdirSync(out, { recursive: true })
  const rec = new Recorder(page, `${out}/frames`)
  const marks = []
  return {
    rec,
    async start() { await rec.start(VW * DPR, VH * DPR); await sleep(300); this.mark('start') },
    mark(name) { marks.push({ name, t: Date.now() / 1000 }); console.log('mark', name) },
    async stop() { this.mark('end'); const info = await rec.stop(); writeFileSync(`${out}/marks.json`, JSON.stringify({ K, frames: rec.frames, marks, info })); console.log('recorded', info); return info },
  }
}
