// The script Finesse puts into Moonlight-Web's page (see browserStream.ts). It
// runs in the frame, beside Moonlight-Web's own code:
//
// - signs in with an access PIN Finesse fetches, and starts the app Finesse named;
// - tells the Finesse page how that goes (postMessage, source 'finesse-stream');
// - sets the stream quality Finesse chose (?q=1080p60…; "auto" leaves it to
//   Moonlight-Web), and with a fixed one keeps Moonlight-Web from changing it
//   mid-game (each change restarts the stream in Wolf);
// - gives the stream a menu a controller can reach: View + Menu + LB + RB
//   (Moonlight's own combo, no game uses it), holding the Guide button, or
//   Ctrl+Alt+Shift+M. While it's open the controller no longer reaches the
//   game. Keep playing / Performance stats / Back to Finesse / Quit game.
//
// It leans on Moonlight-Web 0.4's own pieces (MoonlightApp, its streamView's pad
// hold and stats card), which is why Finesse pins that version.
//
// No backticks or dollar-brace in here: it's one template string.

export const BOOT_JS = `// Finesse: sign in, start one app, and a menu for the controller.
const tell = (msg) => window.parent !== window && window.parent.postMessage({ source: 'finesse-stream', ...msg }, '*')
const want = new URLSearchParams(location.search).get('app') || ''
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const GUIDE_MS = 800
const QUALITY = /^(720|1080|1440|2160)p(30|60|120)$/.exec(new URLSearchParams(location.search).get('q') || '')
const MW_KEY = 'mw-streaming-settings'
// Bitrates in kbps for 60 fps (more frames, more bits).
const BITRATE = { 720: 10000, 1080: 20000, 1440: 35000, 2160: 60000 }
function applyQuality() {
  let s = {}
  try { s = JSON.parse(localStorage.getItem(MW_KEY) || '{}') || {} } catch {}
  if (QUALITY) {
    const h = Number(QUALITY[1]), fps = Number(QUALITY[2])
    Object.assign(s, { stream_resolution: 'fixed', stream_height: h, stream_fps: fps, stream_bitrate: Math.round(BITRATE[h] * Math.max(0.6, fps / 60)), stream_bitrate_auto: false, finesse_quality: QUALITY[0] })
  } else if (s.finesse_quality) {
    // Back to Moonlight-Web's own choice: undo what Finesse set.
    Object.assign(s, { stream_resolution: 'auto', stream_fps: 0, stream_bitrate_auto: true })
    delete s.finesse_quality
  } else return
  try { localStorage.setItem(MW_KEY, JSON.stringify(s)) } catch {}
}
applyQuality()
let App = null

function view() {
  return App && App.streamView ? App.streamView : null
}
function statsOn() {
  const v = view()
  return !!(v && v._showPerfStats && !v._statsClosed)
}
function toggleStats() {
  const v = view()
  if (v && typeof v._toggleStatsFromMenu === 'function') v._toggleStatsFromMenu()
  tell({ state: 'stats', on: statsOn() })
}

// ---------- The menu ----------
let menu = null
let picked = 0
const ITEMS = [
  { id: 'resume', label: 'Keep playing' },
  { id: 'stats', label: 'Performance stats' },
  { id: 'leave', label: 'Back to Finesse', note: 'The game keeps running for 10 minutes' },
  { id: 'quit', label: 'Quit game', note: 'Closes the game, then back to Finesse' },
]
function drawMenu() {
  if (!menu) return
  const buttons = menu.querySelectorAll('button')
  buttons.forEach((b, i) => {
    const on = i === picked
    b.style.background = on ? '#fff' : 'rgba(255,255,255,0.06)'
    b.style.color = on ? '#0b0b0f' : '#fff'
    b.style.borderColor = on ? '#fff' : 'rgba(255,255,255,0.12)'
    const id = b.getAttribute('data-id')
    if (id === 'stats') b.querySelector('.v').textContent = statsOn() ? 'On' : 'Off'
  })
}
function openMenu() {
  if (menu) return
  const v = view()
  if (v && typeof v._holdPads === 'function') v._holdPads('finesse-menu')
  if (v && typeof v._releaseAllPhysKeys === 'function') v._releaseAllPhysKeys()
  picked = 0
  menu = document.createElement('div')
  menu.setAttribute('role', 'dialog')
  menu.setAttribute('aria-label', 'Finesse')
  menu.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);font:15px system-ui,-apple-system,Segoe UI,sans-serif'
  const box = document.createElement('div')
  box.style.cssText = 'width:min(360px,90vw);padding:20px;border-radius:18px;background:#111118;border:1px solid rgba(255,255,255,0.1);box-shadow:0 20px 60px rgba(0,0,0,0.6)'
  const h = document.createElement('p')
  h.textContent = 'Finesse'
  h.style.cssText = 'margin:0 0 14px;color:#fff;font-weight:600;font-size:17px'
  box.appendChild(h)
  ITEMS.forEach((it, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('data-id', it.id)
    b.style.cssText = 'display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;text-align:left;margin:0 0 8px;padding:12px 14px;border-radius:12px;border:1px solid;cursor:pointer;font:inherit;font-weight:500'
    const l = document.createElement('span')
    l.textContent = it.label
    if (it.note) {
      const n = document.createElement('span')
      n.textContent = it.note
      n.style.cssText = 'display:block;font-size:12px;font-weight:400;opacity:0.65;margin-top:2px'
      l.appendChild(n)
    }
    const val = document.createElement('span')
    val.className = 'v'
    val.style.cssText = 'font-size:13px;opacity:0.8'
    b.appendChild(l)
    b.appendChild(val)
    b.addEventListener('mouseenter', () => ((picked = i), drawMenu()))
    b.addEventListener('click', (e) => (e.stopPropagation(), choose(it.id)))
    box.appendChild(b)
  })
  const hint = document.createElement('p')
  hint.textContent = 'A to choose · B to close'
  hint.style.cssText = 'margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:12px;text-align:center'
  box.appendChild(hint)
  menu.appendChild(box)
  menu.addEventListener('click', (e) => e.target === menu && closeMenu())
  document.body.appendChild(menu)
  drawMenu()
  tell({ state: 'menu', open: true })
}
function closeMenu() {
  if (!menu) return
  menu.remove()
  menu = null
  const v = view()
  if (v && typeof v._releasePads === 'function') v._releasePads('finesse-menu')
  tell({ state: 'menu', open: false })
}
function choose(id) {
  if (id === 'stats') return void (toggleStats(), drawMenu())
  closeMenu()
  if (id === 'leave') tell({ state: 'leave' })
  else if (id === 'quit') tell({ state: 'quit' })
}

// ---------- The controller: the chord, and the menu's buttons ----------
let chordSince = 0
let chordFired = false
const prev = {}
function pressed(gp, i) {
  return !!(gp.buttons[i] && gp.buttons[i].pressed)
}
function edge(key, now) {
  const was = prev[key]
  prev[key] = now
  return now && !was
}
setInterval(() => {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p) => p && p.connected) : []
  let chord = ''
  let up = false, down = false, a = false, b = false, start = false
  for (const gp of pads) {
    // View + Menu + LB + RB at once, or the Guide button held.
    if (pressed(gp, 8) && pressed(gp, 9) && pressed(gp, 4) && pressed(gp, 5)) chord = 'now'
    else if (pressed(gp, 16) && !chord) chord = 'hold'
    const ay = gp.axes[1] || 0
    up = up || pressed(gp, 12) || ay < -0.6
    down = down || pressed(gp, 13) || ay > 0.6
    a = a || pressed(gp, 0)
    b = b || pressed(gp, 1)
    start = start || pressed(gp, 9)
  }
  const now = performance.now()
  if (chord) {
    if (!chordSince) chordSince = now
    if (!chordFired && (chord === 'now' || now - chordSince >= GUIDE_MS) && view()) {
      chordFired = true
      if (menu) closeMenu()
      else openMenu()
    }
  } else {
    chordSince = 0
    chordFired = false
  }
  // The menu's own buttons (the chord's release doesn't count as a press).
  const eUp = edge('up', up), eDown = edge('down', down), eA = edge('a', a), eB = edge('b', b)
  if (!menu || chord) return
  if (eUp) (picked = (picked + ITEMS.length - 1) % ITEMS.length), drawMenu()
  if (eDown) (picked = (picked + 1) % ITEMS.length), drawMenu()
  if (eA) choose(ITEMS[picked].id)
  if (eB) closeMenu()
}, 16)

// The keyboard: Ctrl+Alt+Shift+M opens it; in it, arrows, Enter, Escape.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyM') {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (!e.repeat) (menu ? closeMenu() : view() && openMenu())
    return
  }
  if (!menu) return
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.key === 'ArrowUp') (picked = (picked + ITEMS.length - 1) % ITEMS.length), drawMenu()
  else if (e.key === 'ArrowDown') (picked = (picked + 1) % ITEMS.length), drawMenu()
  else if (e.key === 'Enter' || e.key === ' ') choose(ITEMS[picked].id)
  else if (e.key === 'Escape') closeMenu()
}, true)
window.addEventListener('keyup', (e) => {
  if (menu) (e.preventDefault(), e.stopImmediatePropagation())
}, true)

// From the Finesse page (its own buttons).
window.addEventListener('message', (e) => {
  if (e.source !== window.parent || !e.data || e.data.source !== 'finesse') return
  if (e.data.cmd === 'stats') toggleStats()
  else if (e.data.cmd === 'menu') (menu ? closeMenu() : view() && openMenu())
})

// ---------- Sign in, start ----------
async function main() {
  const src = document.querySelector('script[type="module"][src^="/js/app.js"]')?.getAttribute('src') ?? '/js/app.js'
  const { MoonlightApp } = await import(src)
  App = MoonlightApp
  // A fixed quality stays fixed: no stepping down on a busy network, no stepping back up (each step
  // restarts the stream in Wolf, which has been seen to keep the old one's graphics memory).
  if (QUALITY) {
    MoonlightApp._onStreamCongested = function () {}
    MoonlightApp._maybeUpgradeQuality = function () {}
  }
  const { BackendClient } = await import('/js/api/BackendClient.js')
  async function signIn() {
    tell({ state: 'signing-in' })
    const r = await fetch('/__finesse/pin', { method: 'POST', cache: 'no-store' })
    if (!r.ok) throw new Error((await r.text()) || 'Finesse couldn’t sign in to Moonlight-Web')
    await BackendClient.validatePin((await r.text()).trim(), 'Finesse', true)
    location.reload()
  }
  const status = await BackendClient.getAuthStatus().catch(() => ({}))
  if (!status.authenticated && !status.is_localhost) return signIn()
  tell({ state: 'starting' })
  const hosts = await BackendClient.getHosts()
  for (const host of Array.isArray(hosts) ? hosts : hosts.hosts ?? []) {
    const r = await BackendClient.getAppList(host.uuid).catch(() => null)
    const app = (Array.isArray(r) ? r : r?.apps ?? []).find((a) => a.name === want || a.title === want)
    if (!app) continue
    for (let i = 0; i < 100 && MoonlightApp.state === 'loading'; i++) await wait(100)
    await MoonlightApp.launchApp(host, app, undefined, undefined, { skipSelfStreamWarn: true })
    for (let i = 0; i < 300; i++) {
      if (MoonlightApp.state === 'streaming') {
        sessionStorage.removeItem('finesse-signed-in-again')
        tell({ state: 'streaming', stats: statsOn() })
        // Afterwards: say when the stream ends.
        for (;;) {
          await wait(1000)
          if (MoonlightApp.state !== 'streaming' && MoonlightApp.state !== 'launching') {
            closeMenu()
            return tell({ state: 'ended' })
          }
        }
      }
      await wait(200)
    }
    // A sign-in from another page isn't bound to this page's key: sign in again here, once.
    if (!sessionStorage.getItem('finesse-signed-in-again')) {
      sessionStorage.setItem('finesse-signed-in-again', '1')
      return signIn()
    }
    return tell({ state: 'error', error: 'The stream didn’t start. Is the graphics card busy?' })
  }
  tell({ state: 'error', error: 'Moonlight-Web has no server with "' + want + '". Is it paired with Wolf?' })
}
main().catch((e) => tell({ state: 'error', error: String(e?.message ?? e) }))
`
