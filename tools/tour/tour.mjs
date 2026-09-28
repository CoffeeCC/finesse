// The Finesse tour — desktop segment (install → wizard → every app feature).
// node tour.mjs <outdir> [--dry]   (--dry: no recording, screenshots at each step)
import { execSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { launch, newStage, Recorder, director, sleep, K, voWait, sfx, cueTimes } from './lib.mjs'
import { APP, WIZ, PASSWORD, ids as demoIds, voIndex } from './config.mjs'

const OUT = process.argv[2]
const DRY = process.argv.includes('--dry')
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7)
mkdirSync(OUT, { recursive: true })
const ids = demoIds()
const PW = PASSWORD

const b = await launch()
const { page } = await newStage(b)
const d = director(page)
const rec = new Recorder(page, `${OUT}/frames`)
let n = 0
let capN = 0
if (DRY) {
  // Dry runs: a screenshot 1.5 s after every caption, to check each beat.
  const cap = d.caption
  d.caption = async (t, s, ms) => {
    await cap(t, s, ms)
    await sleep(1500)
    await page.screenshot({ path: `${OUT}/cap-${String(++capN).padStart(2, '0')}-${t.replace(/\W+/g, '-').slice(0, 30)}.png` }).catch(() => {})
  }
}
const chapters = []
async function scene(name, fn) {
  if (ONLY && !ONLY.split(',').includes(name)) return
  const t = Date.now()
  chapters.push({ name, at: t / 1000 })
  try {
    await fn()
    console.log(`✔ ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`)
  } catch (e) {
    console.log(`✖ ${name}: ${String(e.message).split('\n')[0]}`)
    await page.screenshot({ path: `${OUT}/fail-${name}.png` }).catch(() => {})
  }
  if (DRY) await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` }).catch(() => {})
}
const by = (role, name, opts) => page.getByRole(role, { name, ...opts }).first()
const text = (t) => page.getByText(t, { exact: false }).first()
async function blank() {
  await page.goto('about:blank')
  await page.setContent('<html><body style="margin:0;background:#0b0d12"></body></html>')
}

// Warm-up: sign the app in once (off camera) so later navigation is instant.
await page.goto(`${APP}/login`)
await sleep(2000)
if (ONLY && !ONLY.includes('signin')) {
  await page.getByRole('button', { name: /Watch as alex/ }).click()
  await page.fill('input[type=password]', PW)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/finesse\/?$/)
  await sleep(2000)
}
await blank()
if (!DRY) await rec.start()

await scene('intro', async () => {
  await d.card('', 'Finesse.', 'Your own streaming service — movies, shows and music on every screen. Installed, connected and looked after for you.', null, 5200)
  await d.card('Step 1 · Install', 'One command', 'On any Linux computer. It installs Docker if needed, starts Finesse and gives you a setup link.', 'curl -fsSL https://raw.githubusercontent.com/CoffeeCC/finesse/master/install.sh | bash', 6200)
})

await scene('wizard', async () => {
  const code = execSync('docker exec finesse-wiz finesse setup-code').toString().trim()
  await page.goto(`${WIZ}/setup?code=${code}`)
  await voWait()
  await d.uncard()
  await page.getByText('Checking this machine').first().waitFor({ timeout: 20000 })
  await d.caption('Step 2 · The setup page', 'Open the link the installer printed. Finesse checks the machine first.')
  await page.getByText('Docker ', { exact: false }).first().waitFor({ timeout: 60000 })
  await sleep(3500)
  await d.click(by('button', 'Continue'))
  await d.caption('Your account', 'You’re the administrator. Time zone, country and language are guessed for you.')
  await d.click(page.getByLabel('Username'))
  await d.type('alex')
  await d.click(page.getByLabel('Password', { exact: true }))
  await d.type('••••••••••'.replace(/•/g, 'x'), 40)
  await d.click(page.getByLabel('Password again'))
  await d.type('xxxxxxxxxx', 40)
  await d.click(page.getByLabel('Name', { exact: true }))
  await page.keyboard.press('Control+A')
  await d.type('The Den')
  await sleep(700)
  await d.click(by('button', 'Continue'))
  await d.caption('Pick your libraries', 'Movies, TV and music — each gets its own folder and manager. Retro games too, if you like.')
  await sleep(1800)
  const gamesCard = by('button', /^Games/)
  if (await gamesCard.count()) await d.hover(gamesCard, { after: 2200 })
  await d.click(by('button', 'Continue'))
  await d.caption('How new things arrive', 'Usenet, torrents (only ever through your VPN), both — or neither.')
  await d.click(page.getByRole('checkbox', { name: /Usenet/ }))
  await d.click(page.getByRole('checkbox', { name: /Torrents/ }))
  await sleep(1200)
  await d.click(by('button', 'Continue'))
  await d.caption('Your Usenet provider', 'Pick it from the list — the server details fill themselves in.')
  await d.click(page.getByLabel('Provider'))
  await page.getByLabel('Provider').selectOption('newshosting')
  await sleep(600)
  await d.click(page.getByLabel('Username'))
  await d.type('den-usenet')
  await d.click(page.getByLabel('Password'))
  await d.type('xxxxxxxxxxxx', 30)
  await sleep(900)
  await d.click(by('button', 'Continue'))
  await d.caption('Your VPN', 'Choose the provider and paste its WireGuard key — Finesse tells you where to find it. “Test” opens a real tunnel.')
  await d.click(page.getByRole('button', { name: 'Mullvad', exact: true }))
  await sleep(700)
  await d.click(page.getByLabel('Private key'))
  await d.type('wOEI9rqqbDwnN8/Bpp22sVz48T71vJ4fYmFWujulwUU=', 18)
  await d.click(page.getByLabel('Address'))
  await d.type('10.64.222.21/32', 30)
  await sleep(1200)
  await d.click(by('button', 'Continue'))
  await d.caption('Indexers — where to search', 'Add yours with its API key. “Test” runs a real search.')
  await d.click(page.getByRole('button', { name: '+ NZBgeek' }))
  await d.click(page.getByLabel('API key'))
  await d.type('xxxxxxxxxxxxxxxxxxxxxxxx', 20)
  await sleep(900)
  await d.click(by('button', 'Continue'))
  await d.caption('Quality', 'The default for new requests — each request can still choose.')
  await sleep(2000)
  await d.click(by('button', 'Continue'))
  await d.caption('Watching away from home', 'Optional: Tailscale Funnel or Cloudflare Tunnel — no router changes.')
  await d.click(page.getByRole('radio', { name: /Tailscale Funnel/ }))
  await sleep(2600)
  await d.click(page.getByRole('radio', { name: /Only at home/ }))
  await d.click(by('button', 'Continue'))
  await d.caption('Invite emails', 'Optional: any SMTP account, so invites land in people’s inboxes.')
  await sleep(1800)
  await d.click(by('button', 'Continue'))
  await d.caption('Review, then build', 'Nothing is installed until you press Build.')
  await sleep(3200)
  await d.hover(by('button', 'Build my server'))
  await sleep(1200)
})

await scene('build', async () => {
  // The real build takes about ten minutes. Here the page gets the same
  // progress it would, sped up to the length of the narration.
  const VOI = voIndex()
  const BUILD_S = (VOI['vo:Building your server']?.dur ?? 8) + 0.6
  const STEPS = [
    ['check', 'Checking this machine', 'Docker, disk space and VPN support look good'],
    ['folders', 'Creating folders', 'Media, downloads and settings folders'],
    ['download', 'Downloading apps', 'Downloading Sonarr…'],
    ['jellyfin', 'Starting Jellyfin', 'Waiting for Jellyfin to finish starting…'],
    ['jellyfin-setup', 'Setting up your libraries', 'Movies, Shows and Music'],
    ['downloaders', 'Starting downloaders', 'Connecting qBittorrent to the VPN…'],
    ['managers', 'Starting Sonarr, Radarr & friends', 'Starting Lidarr…'],
    ['connect', 'Connecting everything', 'Adding NZBgeek to Prowlarr…'],
    ['finish', 'Finishing up', 'Saving your settings'],
  ]
  let t0 = 0
  const status = () => {
    const el = t0 ? (Date.now() - t0) / 1000 / K : 0
    const per = BUILD_S / STEPS.length
    const done = el >= BUILD_S
    return {
      state: done ? 'done' : 'running',
      steps: STEPS.map(([id, title, detail], i) => {
        const st = el >= (i + 1) * per ? 'done' : el >= i * per ? 'running' : 'pending'
        return { id, title, state: st, ...(st === 'running' ? { detail } : {}) }
      }),
      log: [],
      warnings: [],
      services: ['jellyfin', 'prowlarr', 'sonarr', 'radarr', 'lidarr', 'sabnzbd', 'gluetun', 'qbittorrent'],
    }
  }
  await page.route('**/api/setup/validate', (r) => r.fulfill({ json: { ok: true, problems: [] } }))
  await page.route('**/api/setup/apply', (r) => {
    t0 = Date.now()
    return r.fulfill({ status: 202, json: status() })
  })
  await page.route('**/api/setup/status', (r) => r.fulfill({ json: status() }))
  await d.click(by('button', 'Build my server'), { after: 400 })
  await d.caption('Building your server', 'Finesse downloads and connects Jellyfin, Sonarr, Radarr, Lidarr, Prowlarr, SABnzbd and qBittorrent — about 10 minutes.')
  await d.move(1500, 540, 700)
  await text('Your server is ready').waitFor({ timeout: 120000 * K })
  sfx('chime')
  await d.caption('Ready', 'Everything is wired together, checked every minute and backed up nightly.')
  await sleep(4200)
  await d.clear()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

await scene('signin', async () => {
  await page.goto(`${APP}/login`)
  await by('button', /Watch as alex/).waitFor({ timeout: 20000 })
  await d.showCursor()
  await d.caption('Who’s watching?', 'Everyone at home gets their own profile, history and My List.')
  await sleep(2400)
  await d.click(by('button', /Watch as alex/))
  await d.type(PW, 35)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/finesse\/?$/, { timeout: 20000 })
  await d.clear()
  await sleep(2500)
})

await scene('home', async () => {
  await d.caption('Home', 'A spotlight on your library, with the logo art and one-tap Play.')
  await d.move(1250, 420, 900)
  await sleep(2600)
  await d.click(by('button', 'Show featured item 3'), { after: 2400 })
  await d.caption('Up next for you', 'Pick up exactly where you left off — including the next episode.')
  await d.scroll(560, 1400)
  await sleep(1200)
  await d.hover(page.getByRole('link', { name: /Play Pioneer One/ }))
  await sleep(2200)
  await d.caption('My List & Top 10 at home', 'Save things for later, and see what your household actually watches most.')
  await d.scroll(780, 1600)
  await sleep(3400)
  await d.caption('Recently added, genres, and more', 'Rows adapt to your library. Hide, reorder or add any row with Customize Home.')
  await d.scroll(900, 1800)
  await sleep(2200)
  await d.scroll(1400, 1600)
  await sleep(2400)
  await d.clear()
})

await scene('search', async () => {
  await page.evaluate(() => window.scrollTo({ top: 0 }))
  await sleep(600)
  await d.caption('Search everything', 'Press / anywhere. Movies, shows, episodes and people as you type.')
  await d.click(by('button', 'Search (press /)'))
  await d.type('sin', 110)
  await sleep(2200)
  await page.keyboard.press('Escape')
  await sleep(400)
})

await scene('detail', async () => {
  await page.goto(`${APP}/item/${ids['Sintel']}`)
  await text('A wandering warrior').waitFor({ timeout: 20000 })
  await d.caption('Every title has a page', 'A preview plays behind it. My List, Favorite and Play on another device are one tap away.')
  await sleep(3200)
  await d.click(page.getByRole('button', { name: 'Add to My List' }), { after: 1600 })
  await d.click(by('tab', 'Cast and details'), { after: 2200 })
  await d.scroll(500, 1000)
  await sleep(1800)
  await d.scroll(-500, 800)
  await d.clear()
})

await scene('player', async () => {
  await d.caption('The player', 'Big, clear controls. Skip back or forward 10 seconds, chapters, and quick access to audio and subtitles.')
  await d.click(page.getByRole('link', { name: /^Play/ }).first(), { after: 3500 })
  await d.move(960, 700, 500)
  await sleep(1500)
  await d.click(by('button', 'Audio and subtitles'), { after: 900 })
  await d.click(page.getByRole('menuitemradio', { name: /English/ }), { after: 600 })
  await d.caption('Subtitles, your way', 'Pick a language — Finesse remembers it for the whole series.')
  await sleep(3000)
  await d.click(by('button', 'Audio and subtitles'), { after: 1200 })
  const seek = page.getByRole('slider', { name: 'Seek' }).first()
  const box = await seek.boundingBox().catch(() => null)
  if (box) {
    await d.caption('Scrub with previews', 'Hover the timeline to see where you’re going.')
    await d.move(box.x + box.width * 0.3, box.y + box.height / 2, 700)
    await d.move(box.x + box.width * 0.7, box.y + box.height / 2, 1600)
    await sleep(900)
  }
  await d.click(by('button', 'Forward 10 seconds'), { after: 1500 })
  await d.caption('Pause for more', 'Pausing shows what you’re watching, and what’s next.')
  await page.keyboard.press('Space')
  await d.move(1500, 300, 600)
  await sleep(3800)
  await d.click(by('button', 'Back'), { after: 1500 })
  await d.clear()
})

await scene('shows', async () => {
  if (!page.url().startsWith(APP)) await page.goto(`${APP}/`)
  await d.caption('Movies & Shows', 'Browse by genre, filter by what you’ve watched, sort any way — or let Surprise me pick.')
  await d.click(page.getByRole('link', { name: 'Shows', exact: true }).first(), { after: 3000 })
  await sleep(1500)
  await page.goto(`${APP}/item/${ids['Pioneer One']}`)
  await text('Season 1').waitFor({ timeout: 20000 })
  await d.caption('Episodes remember where you are', 'Resume S1:E2 — and “Up next” marks the episode after the one you finished.')
  await sleep(2400)
  await d.scroll(520, 1100)
  await sleep(2600)
  await d.scroll(0, 900)
  await d.click(page.getByRole('link', { name: /^(Resume|Play)/ }).first(), { after: 3500 })
  await d.caption('Next episode, one tap', 'Near the end, the next episode lines up by itself — and Next episode is always in the controls.')
  const next = by('button', 'Next episode')
  await d.hover(next, { after: 2600 })
  const bar = page.getByRole('slider', { name: 'Seek' }).first()
  const bb = await bar.boundingBox().catch(() => null)
  if (bb) await d.clickAt(bb.x + bb.width * 0.975, bb.y + bb.height / 2, { after: 1500 })
  const playNow = by('button', /Play now/)
  await playNow.waitFor({ timeout: 30000 })
  await sleep(3800)
  await d.click(playNow, { after: 3500 })
  await d.click(by('button', 'Back'), { after: 1500 })
  await d.clear()
})

await scene('request', async () => {
  await page.goto(`${APP}/`)
  await sleep(1500)
  await d.caption('Don’t have it? Request it.', 'Search for anything. If it isn’t in your library, press Request — Finesse finds it, downloads it and adds it for you.')
  await d.click(by('button', 'Search (press /)'))
  await d.type('the iron giant', 90)
  await page.getByRole('button', { name: 'Request' }).first().waitFor({ timeout: 25000 })
  await sleep(2000)
  await d.click(page.getByRole('button', { name: 'Request' }).first(), { after: 2400 })
  await d.caption('One tap', 'It’s requested at your default quality. Open a title to pick a different quality or version.')
  await sleep(3200)
  await page.keyboard.press('Escape')
  await sleep(600)
  await page.goto(`${APP}/request`)
  await d.caption('Requests and downloads', 'Requests wait here until a release turns up. Then follow the download, pause it or cap its speed.')
  await sleep(3800)
  await d.clear()
})

await scene('music', async () => {
  await page.goto(`${APP}/music`)
  await text('Thing a Week Three').waitFor({ timeout: 20000 })
  await d.caption('Music', 'Albums and artists with a proper music player.')
  await sleep(2200)
  await d.click(page.getByRole('link', { name: /Thing a Week Three/ }).first(), { after: 2200 })
  await d.click(page.getByRole('button', { name: /Code Monkey/ }).first(), { after: 2500 })
  await d.click(page.getByTitle('Open now playing'), { after: 2000 })
  await d.caption('Synced lyrics', 'Lyrics follow the song line by line — found online when your files don’t have them.')
  await sleep(6500)
  const lv = page.getByRole('button', { name: 'Lyric video' }).first()
  if (await lv.count()) {
    await d.caption('Lyric video', 'Or turn any song into a full-screen lyric video.')
    await d.click(lv, { after: 8000 })
  }
  await d.clear()
  const close = page.getByRole('button', { name: 'Close now playing' }).first()
  if (await close.count()) await d.click(close, { after: 900 })
  const stop = page.getByRole('button', { name: 'Close player' }).first()
  if (await stop.count()) await d.click(stop, { after: 600 })
})

await scene('games', async () => {
  await page.goto(`${APP}/games`)
  await text('Tobu Tobu Girl').waitFor({ timeout: 30000 })
  await d.caption('Games', 'Turn on Games and add the games you own — right next to your movies, with box art wherever Finesse can find it.')
  await sleep(2800)
  await d.click(page.getByRole('link', { name: /Tobu Tobu Girl/ }).first(), { after: 2800 })
  await d.caption('Play in your browser', 'Press Play: it runs on your own device, with a controller or the keyboard.')
  // Start from a save state at the title screen (skips the splash screens,
  // same every take), then slow the emulator — it counts frames rather than
  // reading the clock — to match everything else.
  await page.evaluate(() => { window.__gs = 0; window.EJS_onGameStart = () => (window.__gs = 1) })
  await d.click(page.getByRole('link', { name: /^Play/ }).or(page.getByRole('button', { name: /^Play/ })).first(), { after: 300 })
  await d.move(1840, 560, 500)
  await page.waitForFunction(() => window.__gs > 0, null, { timeout: 90000 })
  await page.evaluate((b64) => {
    const bin = atob(b64)
    const u = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
    window.EJS_emulator.gameManager.loadState(u)
    window.__tourGameClock = true
    window.__tourGameFrames = 0
    window.__tourGameT0 = performance.now()
  }, readFileSync(new URL('./assets/tobu-title.state.b64', import.meta.url), 'utf8'))
  const hold = async (key, ms, after = 350) => {
    await page.keyboard.down(key)
    await sleep(ms)
    await page.keyboard.up(key)
    await sleep(after)
  }
  await sleep(1600)
  await hold('Enter', 160, 1500)
  await hold('z', 160, 1800)
  await d.clear()
  for (const [key, ms] of [['ArrowRight', 900], ['z', 150], ['ArrowLeft', 1100], ['z', 150], ['ArrowRight', 1300], ['ArrowLeft', 700], ['z', 150], ['ArrowRight', 800]]) await hold(key, ms)
  await sleep(1000)
  const fps = await page.evaluate(() => ((window.__tourGameClock = false), window.__tourGameFrames / ((performance.now() - window.__tourGameT0) / 1000)))
  if (K > 1) console.log(`  game frames per (slowed) second: ${fps.toFixed(1)}`)
})

await scene('settings', async () => {
  await page.goto(`${APP}/settings`)
  await sleep(1800)
  await d.caption('Make it yours', 'Accent colour, display size, interface sounds — per device or synced to your account.')
  await d.click(by('button', 'Appearance'), { after: 1500 })
  const accents = page.getByRole('radio')
  const count = await accents.count()
  for (const i of [2, 4, 0].filter((x) => x < count)) await d.click(accents.nth(i), { after: 1100 })
  await d.caption('Settings → Server', 'For admins: every app’s health, the VPN, storage, backups and updates. Finesse repairs itself every minute.')
  await d.click(by('button', /^Server/), { after: 3200 })
  await sleep(2500)
  await d.scroll(700, 1500)
  await sleep(2600)
  await d.caption('Invite people', 'Make an invite link, show a QR code, or email it — they create their own account.')
  await d.scroll(1500, 1800)
  await sleep(800)
  const create = by('button', 'Create invite')
  await d.click(create, { after: 2600 })
  const qr = page.getByRole('button', { name: 'QR', exact: true }).first()
  if (await qr.count()) {
    await d.click(qr, { after: 900 })
    await d.scroll(380, 900)
    await sleep(2600)
  }
  await d.clear()
})

if (!DRY) {
  await voWait()
  await sleep(600)
  const r = await rec.stop()
  writeFileSync(`${OUT}/cues.json`, JSON.stringify(cueTimes(r.t0), null, 1))
  console.log(r)
  writeFileSync(`${OUT}/chapters.json`, JSON.stringify(chapters.map((c) => ({ name: c.name, t: Math.max(0, +((c.at - r.t0) / K).toFixed(2)) })), null, 1))
}
await b.close()
