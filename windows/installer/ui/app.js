// Finesse Setup for Windows: the page. The exe (Shell.cs) answers calls and sends progress events;
// opened in a plain browser, a pretend bridge plays a whole install so the page can be worked on.
'use strict'

const params = new URLSearchParams(location.search)
const $ = (s, el = document) => el.querySelector(s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const gb = (bytes) => (bytes >= 1e12 ? (bytes / 1e12).toFixed(1) + ' TB' : Math.round(bytes / 1e9) + ' GB')
const SELFTEST = params.has('selftest')

// ---------- the bridge ----------
function realBridge() {
  const wv = window.chrome.webview
  let n = 0
  const pending = new Map()
  const subs = {}
  wv.addEventListener('message', (e) => {
    const m = e.data
    if (m.event) (subs[m.event] || []).forEach((f) => f(m.data))
    else if (pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error))
    }
  })
  return {
    real: true,
    call: (cmd, args = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); wv.postMessage({ id, cmd, args }) }),
    on: (ev, f) => { (subs[ev] = subs[ev] || []).push(f); return () => { subs[ev] = subs[ev].filter((x) => x !== f) } },
  }
}

/** A pretend PC, for working on the page in a browser: ?mock=fresh | docker | installed | slow */
function mockBridge() {
  const scenario = params.get('mock') || 'fresh'
  const subs = {}
  const emit = (ev, d) => (subs[ev] || []).forEach((f) => f(d))
  const fast = scenario !== 'slow'
  const t = (ms) => sleep(fast ? ms / 3 : ms)
  const drives = [
    { letter: 'C', label: 'Windows', free: 182e9, total: 512e9, system: true },
    { letter: 'D', label: 'Media', free: 3.41e12, total: 4e12, system: false },
    { letter: 'E', label: 'Games', free: 640e9, total: 2e12, system: false },
  ]
  const state = { docker: scenario !== 'fresh', running: scenario === 'installed' || scenario === 'docker', finesse: scenario === 'installed' }
  const media = (path) => {
    const ok = /^[A-Za-z]:\\[^ ]*$/.test(path)
    return { path, ok, free: 3.41e12, linux: '/run/desktop/mnt/host/' + path[0].toLowerCase() + path.slice(2).replace(/\\/g, '/'), error: ok ? null : 'Use a folder whose path has no spaces or accents, like D:\\Finesse.' }
  }
  const api = {
    async info() {
      await t(600)
      return {
        windows: { name: 'Windows 11 Pro', version: '24H2', build: 26100, arch: 'x64', supported: true },
        memoryGB: 32, cores: 12, virtualization: 'on', wsl: state.docker,
        docker: { installed: state.docker, running: state.running, version: state.running ? '28.4.0' : null },
        finesse: state.finesse ? { installed: true, running: true, port: 8080, code: 'K7QM-3XPD' } : { installed: false },
        drives, lan: '192.168.1.50', networkPublic: false, log: 'C:\\Users\\you\\AppData\\Local\\Finesse\\setup.log', image: 'ghcr.io/coffeecc/finesse:latest',
      }
    },
    async defaultMedia() { return media('D:\\Finesse') },
    async checkMedia({ path }) { return media(path) },
    async downloadDocker() {
      const total = 612e6
      for (let got = 0; got <= total; got += total / 60) { emit('download', { got, total, speed: 38e6 }); await t(90) }
      return { file: 'C:\\Temp\\Docker Desktop Installer.exe' }
    },
    async installDocker() { await t(4000); state.docker = true; return { ok: true, restart: true } },
    async startDocker() { for (let s = 0; s < 12; s += 3) { emit('dockerStarting', { seconds: s }); await t(700) } state.running = true; return { ok: true, version: '28.4.0' } },
    async installFinesse({ port }) {
      emit('install', { step: 'prepare' }); await t(900)
      for (let i = 0; i <= 14; i++) { emit('install', { step: 'pull', progress: i / 14, detail: `${i} of 14` }); await t(260) }
      emit('install', { step: 'start' }); await t(1200)
      emit('install', { step: 'wake' }); await t(2600)
      state.finesse = true
      return { port, code: 'K7QM-3XPD', url: `http://localhost:${port}/finesse/setup?code=K7QM-3XPD`, lan: `http://192.168.1.50:${port}/finesse/`, media: 'D:\\Finesse' }
    },
    async firewall() { await t(900); return { ok: true } },
    async finish() { await t(300); return { shortcut: 'Finesse.url' } },
    async startFinesse() { await t(1200); return { ok: true } },
    async restart() { return true },
    async signout() { return true },
    async uninstall() { await t(2500); state.finesse = false; return { removed: 9 } },
    async log() { return '2026-10-05 21:14:02 Finesse Setup 2.6.0 starting\n2026-10-05 21:14:03 docker info → 0' },
    async pickFolder() { return 'E:\\Movies' },
    async open({ url }) { window.open(url, '_blank') },
    async window({ action }) { if (action === 'close') document.body.style.opacity = 0.3 },
    async shot() { return true },
    async quit() { return true },
  }
  return {
    real: false,
    call: async (cmd, args = {}) => { if (!api[cmd]) throw new Error('mock: ' + cmd); return api[cmd](args) },
    on: (ev, f) => { (subs[ev] = subs[ev] || []).push(f); return () => { subs[ev] = subs[ev].filter((x) => x !== f) } },
  }
}

const B = window.chrome && window.chrome.webview ? realBridge() : mockBridge()

// ---------- the stage ----------
const ART = {
  welcome: { src: 'art/welcome.jpg', fx: '28%' },
  check: { src: 'art/check.jpg', fx: '58%' },
  games: { src: 'art/games.jpg', fx: '50%' },
  popcorn: { src: 'art/popcorn.jpg', fx: '40%' },
  lofi: { src: 'media/lo-finessa-loop.webm', poster: 'media/lo-finessa-still.jpg', fx: '30%', video: true },
  done: { src: 'art/done.jpg', fx: '36%' },
  oops: { src: 'art/oops.jpg', fx: '42%' },
}
let artNow = null
function setArt(name) {
  if (artNow === name) return
  artNow = name
  const a = ART[name]
  const stage = $('#stage')
  const el = document.createElement('div')
  el.className = 'art'
  el.style.setProperty('--fx', a.fx)
  if (a.video && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.innerHTML = `<video src="${a.src}" poster="${a.poster}" muted loop playsinline autoplay style="object-position:${a.fx} 50%"></video>`
  } else {
    el.innerHTML = `<img src="${a.video ? a.poster : a.src}" alt="" style="object-position:${a.fx} 50%" />`
  }
  stage.appendChild(el)
  const show = () => requestAnimationFrame(() => el.classList.add('on'))
  const media = el.firstElementChild
  if (media.complete || media.readyState >= 2) show()
  else { media.addEventListener(a.video ? 'loadeddata' : 'load', show, { once: true }); setTimeout(show, 600) }
  for (const old of [...stage.children]) if (old !== el) setTimeout(() => old.remove(), 1300), old.classList.remove('on')
}

// Nessa's line, typed on.
let sayTimer = null
function say(text) {
  const box = $('#say')
  clearInterval(sayTimer)
  if (SELFTEST || matchMedia('(prefers-reduced-motion: reduce)').matches) { box.textContent = text; return }
  let i = 0
  box.innerHTML = '<span></span><i class="caret"></i>'
  const span = box.firstChild
  sayTimer = setInterval(() => {
    i += 1
    span.textContent = text.slice(0, i)
    if (i >= text.length) { clearInterval(sayTimer); setTimeout(() => box.querySelector('.caret')?.remove(), 1400) }
  }, 22)
}

// ---------- the panel ----------
const STEPS = ['Check', 'Docker', 'Folder', 'Install', 'Done']
function rail(now) {
  const el = $('#rail')
  if (now < 0) { el.classList.add('hide'); return }
  el.classList.remove('hide')
  el.innerHTML = STEPS.map((s, i) => `<div class="s ${i < now ? 'done' : i === now ? 'now' : ''}"><div class="line"><i></i></div><span>${s}</span></div>`).join('')
}

let busy = false
function show(html, { art, line, step = -1 } = {}) {
  if (art) setArt(art)
  if (line) say(line)
  rail(step)
  const view = $('#view')
  const old = view.firstElementChild
  const el = document.createElement('div')
  el.className = 'screen'
  el.innerHTML = html
  if (old) { old.classList.add('leave'); setTimeout(() => old.remove(), 200); el.style.animationDelay = '.15s' }
  view.appendChild(el)
  return el
}

const ICON = {
  docker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="8" rx="2"/><path d="M7 11V7h4v4M11 7h4v4"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>',
}
const ARROW = '<span class="arrow">→</span>'

// ---------- music: the whole Lo-Finessa song, from the moment it opens, if wanted ----------
const song = $('#song')
const music = { on: (() => { try { return localStorage.getItem('finesse.setup.music') !== 'off' } catch { return true } })(), started: false }
function musicUi() {
  const b = $('#music')
  b.hidden = false
  b.classList.toggle('on', music.on && music.started)
  $('#musicLabel').textContent = music.on ? 'Lo-Finessa' : 'Lo-Finessa: off'
}
function fadeTo(v, ms = 1200) {
  const from = song.volume, t0 = performance.now()
  const step = (t) => { const k = Math.min(1, (t - t0) / ms); song.volume = from + (v - from) * k; if (k < 1) requestAnimationFrame(step); else if (v === 0) song.pause() }
  requestAnimationFrame(step)
}
function startMusic() {
  if (!music.on || music.started || SELFTEST) return
  music.started = true
  song.volume = 0
  song.play().then(() => fadeTo(0.32, 1800)).catch(() => { music.started = false })
  musicUi()
}
$('#music').addEventListener('click', (e) => {
  e.stopPropagation()
  music.on = !music.on
  try { localStorage.setItem('finesse.setup.music', music.on ? 'on' : 'off') } catch {}
  if (music.on) { music.started = false; startMusic() } else fadeTo(0, 400)
  musicUi()
})
song.addEventListener('canplay', musicUi, { once: true })
document.addEventListener('pointerdown', startMusic, true)
// On launch: the exe lets the page play without a click (--autoplay-policy in Shell.cs). If that is ever refused, or the song wasn't ready, the next click or the song loading tries again.
startMusic()
song.addEventListener('canplay', startMusic, { once: true })

// ---------- the window ----------
$('#bar').addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('button')) B.call('window', { action: 'drag' }) })
$('#min').addEventListener('click', () => B.call('window', { action: 'minimize' }))
$('#close').addEventListener('click', () => requestClose())
B.on('closeRequested', () => requestClose())
function requestClose() {
  if (!busy) return B.call('window', { action: 'close' })
  modal(`<h2>Stop setting up?</h2><p>Setup is still working. If you close now, open Finesse Setup again later and it carries on from where it can.</p>
    <div class="actions"><button class="btn danger" data-a="stop">Close anyway</button><button class="btn ghost" data-a="keep">Keep going</button></div>`,
    { stop: () => B.call('window', { action: 'close' }) })
}
function modal(html, handlers = {}) {
  const m = $('#modal')
  m.innerHTML = `<div class="card">${html}</div>`
  m.hidden = false
  m.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a
    if (!a && e.target !== m) return
    m.hidden = true
    handlers[a]?.()
  }
}

// ---------- confetti ----------
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const c = $('#confetti'), x = c.getContext('2d')
  const dpr = devicePixelRatio || 1
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; x.scale(dpr, dpr)
  const colors = ['#93a5e8', '#a86ad1', '#f472b6', '#fde68a', '#6ee7b7', '#ffffff']
  const bits = Array.from({ length: 160 }, () => ({
    x: innerWidth * 0.3 + Math.random() * innerWidth * 0.4, y: innerHeight * 0.45, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 15 - 4,
    w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0], life: 0,
  }))
  const t0 = performance.now()
  const frame = (t) => {
    x.clearRect(0, 0, innerWidth, innerHeight)
    for (const b of bits) {
      b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr
      x.save(); x.translate(b.x, b.y); x.rotate(b.r); x.fillStyle = b.c; x.globalAlpha = Math.max(0, 1 - (t - t0) / 4200); x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2))); x.restore()
    }
    if (t - t0 < 4300) requestAnimationFrame(frame); else x.clearRect(0, 0, innerWidth, innerHeight)
  }
  requestAnimationFrame(frame)
}

// ---------- screens ----------
let info = null
let mediaChoice = null

async function main() {
  $('#ver').textContent = params.get('v') ? 'v' + params.get('v') : ''
  setArt(params.has('uninstall') ? 'oops' : 'welcome')
  say('One moment…')
  rail(-1)
  try { info = await B.call('info') } catch (e) { return oops(e.message, main) }
  musicUi()
  if (SELFTEST) return selfTest()
  if (params.has('uninstall')) return uninstallScreen()
  if (params.has('resume')) return dockerStart()
  if (info.finesse.installed) return installedScreen()
  welcome()
}

function welcome() {
  const el = show(`
    <p class="kicker">Welcome</p>
    <h1>Your own <em>streaming service</em>, on this PC.</h1>
    <p class="lead">Finesse puts your movies, shows and music on every screen at home, and finds new ones when someone asks. This sets it all up.</p>
    <div class="facts">
      <div class="fact"><span class="ic">${ICON.docker}</span><span><b>Docker Desktop</b> runs Finesse's apps. Setup installs it if it's missing (free for personal use).</span></div>
      <div class="fact"><span class="ic">${ICON.folder}</span><span><b>Your media</b> goes in a folder you pick, on the drive with room for it.</span></div>
      <div class="fact"><span class="ic">${ICON.clock}</span><span><b>About 10 minutes</b>, plus one restart if Docker is new to this PC.</span></div>
    </div>
    <div class="actions"><button class="btn primary" id="go">Set up Finesse ${ARROW}</button></div>`,
  { art: 'welcome', line: "Hi, I'm Nessa! Let's put your own streaming service on this PC." })
  $('#go', el).onclick = checks
}

async function checks() {
  const w = info.windows
  const items = [
    { name: 'Windows', val: `${w.name}${w.version ? ' ' + w.version : ''}`, state: w.supported ? 'ok' : 'bad', help: w.supported ? '' : 'Finesse needs 64-bit Windows 10 (version 2004 or newer) or Windows 11. Windows Update can get you there.' },
    { name: 'Memory', val: `${Math.round(info.memoryGB)} GB`, state: info.memoryGB >= 8 ? 'ok' : info.memoryGB >= 4 ? 'warn' : 'bad', help: info.memoryGB >= 8 ? '' : info.memoryGB >= 4 ? '8 GB or more keeps everything smooth. It works, just a bit slower.' : 'Finesse and Docker need at least 4 GB of memory.' },
    { name: 'Virtualization', val: info.virtualization === 'on' ? 'On' : info.virtualization === 'off' ? 'Off' : 'Unknown', state: info.virtualization === 'off' ? 'bad' : info.virtualization === 'on' ? 'ok' : 'warn', help: info.virtualization === 'off' ? 'Docker needs it. Turn on "Intel VT-x" or "AMD SVM" in your PC\'s BIOS/UEFI settings, then open Finesse Setup again.' : info.virtualization === 'unknown' ? "Couldn't tell. If Docker won't start later, this is the first thing to check." : '' },
    { name: 'Room for media', val: info.drives.length ? gb(Math.max(...info.drives.map((d) => d.free))) + ' free' : '?', state: info.drives.some((d) => d.free > 100e9) ? 'ok' : 'warn', help: info.drives.some((d) => d.free > 100e9) ? '' : 'Movies take 2–60 GB each. It works, but you\'ll want a bigger drive soon.' },
    { name: 'Docker Desktop', val: info.docker.running ? 'Running' : info.docker.installed ? 'Installed' : 'Not yet', state: info.docker.installed ? 'ok' : 'warn', help: info.docker.installed ? '' : "Setup installs it next." },
  ]
  const el = show(`
    <p class="kicker">Step 1 · This PC</p>
    <h1>Checking <em>this PC</em></h1>
    <div class="checks">${items.map((it, i) => `<div class="check" id="c${i}"><span class="dot wait"></span><span class="name">${esc(it.name)}<small></small></span><span class="val"></span></div>`).join('')}</div>
    <div class="actions"><button class="btn primary" id="next" disabled>Continue ${ARROW}</button></div>`,
  { art: 'check', line: 'Let me peek under the hood real quick…', step: 0 })
  for (let i = 0; i < items.length; i++) {
    const row = $('#c' + i, el)
    row.classList.add('show')
    await sleep(SELFTEST ? 0 : 340)
    const it = items[i]
    const dot = row.querySelector('.dot')
    dot.className = 'dot ' + it.state
    dot.textContent = it.state === 'ok' ? '✓' : it.state === 'warn' ? '!' : '✕'
    row.querySelector('.val').textContent = it.val
    row.querySelector('small').textContent = it.help
  }
  const blocked = items.some((it) => it.state === 'bad')
  const next = $('#next', el)
  if (blocked) {
    next.outerHTML = `<button class="btn ghost" id="again">Check again</button>`
    $('#again', el).onclick = async () => { info = await B.call('info'); checks() }
    say("This PC needs a small change first. I've said what, right there.")
    return
  }
  next.disabled = false
  say(info.docker.installed ? 'Looking good! Docker is already here, too.' : "Looking good! Docker's next.")
  next.onclick = () => (info.docker.running ? folders() : info.docker.installed ? dockerStart() : dockerInstall())
}

async function dockerInstall() {
  const el = show(`
    <p class="kicker">Step 2 · Docker Desktop</p>
    <h1>Getting <em>Docker</em></h1>
    <p class="lead">Finesse runs each of its apps (Jellyfin, the downloaders and the rest) in Docker Desktop. It's free for personal use and small businesses.</p>
    <div class="progress" id="prog" hidden><div class="top"><b id="ptitle">Downloading Docker Desktop</b><span id="pval"></span></div><div class="bar-track" id="track"><div class="bar-fill" id="fill"></div></div></div>
    <p class="small" id="pnote">About 600 MB. Windows asks for permission once, to install it.</p>
    <div class="actions"><button class="btn primary" id="go">Install Docker Desktop ${ARROW}</button><button class="link" id="mine">I'll install it myself</button></div>`,
  { art: 'games', line: "Docker's a big download. Perfect time for a quick game.", step: 1 })
  $('#mine', el).onclick = () => { B.call('open', { url: 'https://docs.docker.com/desktop/setup/install/windows-install/' }); say("Open Finesse Setup again once it's in, and I'll take it from there.") }
  $('#go', el).onclick = async () => {
    busy = true
    $('#go', el).closest('.actions').hidden = true
    $('#prog', el).hidden = false
    const off = B.on('download', (d) => {
      const pct = d.total > 0 ? d.got / d.total : 0
      $('#fill', el).style.width = (pct * 100).toFixed(1) + '%'
      $('#pval', el).textContent = d.total > 0 ? `${Math.round(d.got / 1e6)} of ${Math.round(d.total / 1e6)} MB${d.speed > 0 ? ` · ${(d.speed / 1e6).toFixed(1)} MB/s` : ''}` : ''
    })
    try {
      const { file } = await B.call('downloadDocker')
      off()
      $('#ptitle', el).textContent = 'Installing Docker Desktop'
      $('#pval', el).textContent = 'a few minutes'
      $('#track', el).classList.add('indeterminate')
      $('#pnote', el).textContent = 'Windows is asking for permission: choose Yes. Docker installs quietly in the background.'
      say('Windows will ask for permission. Say yes, I promise I\'m nice.')
      await B.call('installDocker', { file })
      busy = false
      restartScreen()
    } catch (e) { off(); busy = false; oops(e.message, dockerInstall) }
  }
}

function restartScreen() {
  const el = show(`
    <p class="kicker">Step 2 · Docker Desktop</p>
    <h1>One <em>restart</em>, then we're back.</h1>
    <p class="lead">Docker Desktop is installed. Windows needs a restart to finish setting it up. Finesse Setup opens again by itself afterwards and carries on.</p>
    <div class="actions"><button class="btn primary" id="go">Restart now ${ARROW}</button><button class="link" id="later">Later</button></div>
    <p class="small" style="margin-top:14px">Save anything you have open first.</p>`,
  { art: 'lofi', line: "I'll be right here when you're back. Promise.", step: 1 })
  $('#go', el).onclick = () => B.call('restart')
  $('#later', el).onclick = () => { say("No rush. Finesse Setup opens by itself after your next restart."); setTimeout(() => B.call('window', { action: 'close' }), 2600) }
}

async function dockerStart() {
  busy = true
  const el = show(`
    <p class="kicker">Step 2 · Docker Desktop</p>
    <h1>Waking <em>Docker</em> up</h1>
    <p class="lead">Docker Desktop is starting. The first time takes a minute or two.</p>
    <div class="progress"><div class="top"><b>Starting Docker Desktop</b><span id="secs"></span></div><div class="bar-track indeterminate"><div class="bar-fill"></div></div></div>
    <p class="small" id="hint"></p>`,
  { art: 'lofi', line: "Waking Docker up… it's not a morning person.", step: 1 })
  const off = B.on('dockerStarting', (d) => {
    $('#secs', el).textContent = d.seconds + 's'
    if (d.seconds > 50) $('#hint', el).textContent = "Still going. If a Docker Desktop window opened, it may want you to accept its terms or skip signing in: that's all it needs."
  })
  try {
    const r = await B.call('startDocker')
    off()
    busy = false
    if (r.ok) {
      // With Docker up we can see whether Finesse is already here (and never install over it).
      info = await B.call('info').catch(() => info)
      return info.finesse.installed ? installedScreen() : folders()
    }
    if (r.reason === 'signout') return signOutScreen()
    oops("Docker Desktop didn't finish starting. If its window is open, it may be waiting for you (accept its terms, or skip signing in). Then press Try again.", dockerStart, r.detail)
  } catch (e) { off(); busy = false; oops(e.message, dockerStart) }
}

function signOutScreen() {
  const el = show(`
    <p class="kicker">Step 2 · Docker Desktop</p>
    <h1>Sign out, <em>sign back in</em></h1>
    <p class="lead">Docker is running, but Windows lets this account use it only after you sign out and back in. Finesse Setup opens again by itself afterwards.</p>
    <div class="actions"><button class="btn primary" id="go">Restart now ${ARROW}</button><button class="link" id="again">Try again</button></div>`,
  { art: 'lofi', line: 'Windows wants a fresh start. Back in a sec!', step: 1 })
  $('#go', el).onclick = () => B.call('restart')
  $('#again', el).onclick = dockerStart
}

async function folders() {
  if (!mediaChoice) mediaChoice = await B.call('defaultMedia')
  const drives = info.drives.slice().sort((a, b) => a.letter.localeCompare(b.letter))
  const render = () => {
    const sel = mediaChoice.path[0].toUpperCase()
    $('#drives', el).innerHTML = drives.map((d) => `
      <button class="drive ${d.letter === sel ? 'on' : ''}" data-l="${d.letter}">
        <div class="l">${d.letter}:</div><div class="n">${esc(d.label)}</div>
        <div class="f">${gb(d.free)} free</div><div class="meter"><i style="width:${Math.max(3, (1 - d.free / d.total) * 100).toFixed(0)}%"></i></div>
      </button>`).join('')
    $('#path', el).textContent = mediaChoice.path
    $('#err', el).textContent = mediaChoice.ok ? '' : mediaChoice.error
    $('#go', el).disabled = !mediaChoice.ok
  }
  const el = show(`
    <p class="kicker">Step 3 · Your media</p>
    <h1>Where should <em>movies</em> live?</h1>
    <p class="lead">Movies, shows, music and downloads go here. Pick the drive with the most room; you can add more folders later.</p>
    <div class="drives${drives.length > 3 ? ' many' : ''}" id="drives"></div>
    <div class="pathbox"><code id="path"></code><button class="btn ghost" id="pick">Change…</button></div>
    <div class="err" id="err"></div>
    <div class="actions"><button class="btn primary" id="go">Install Finesse ${ARROW}</button></div>`,
  { art: 'popcorn', line: 'Where do your movies live? Pick the roomiest drive.', step: 2 })
  el.classList.add('folders') // the drives scroll if there are many; the folder and Install stay in view
  render()
  $('#drives', el).onclick = async (e) => {
    const l = e.target.closest('.drive')?.dataset.l
    if (!l) return
    mediaChoice = await B.call('checkMedia', { path: `${l}:\\Finesse` })
    render()
  }
  $('#pick', el).onclick = async () => {
    const p = await B.call('pickFolder', { start: mediaChoice.path })
    if (!p) return
    mediaChoice = await B.call('checkMedia', { path: p })
    render()
  }
  $('#go', el).onclick = () => install()
}

async function install() {
  busy = true
  const STEPS_I = [
    ['prepare', 'Getting things ready'],
    ['pull', 'Downloading Finesse'],
    ['start', 'Starting Finesse'],
    ['wake', 'Waiting for it to wake up'],
    ['firewall', 'Letting phones and TVs in'],
    ['finish', 'Adding Finesse to the Start menu'],
  ]
  const el = show(`
    <p class="kicker">Step 4 · Finesse</p>
    <h1>Installing <em>Finesse</em></h1>
    <div class="steps">${STEPS_I.map(([k, label]) => `<div class="step" id="s-${k}"><span class="dot"></span><span>${label}</span><span class="val"></span>${k === 'pull' ? '<div class="mini"><i></i></div>' : ''}</div>`).join('')}</div>
    <p class="small" id="inote" style="margin-top:14px"></p>`,
  { art: 'popcorn', line: "Popcorn's ready. Finesse is on its way.", step: 3 })
  let current = null
  const mark = (k) => {
    if (current === k) return
    const order = STEPS_I.map((s) => s[0])
    for (const [key] of STEPS_I) {
      const row = $('#s-' + key, el)
      const i = order.indexOf(key), j = order.indexOf(k)
      row.className = 'step ' + (i < j ? 'done' : i === j ? 'now' : '')
      if (i < j) row.querySelector('.dot').textContent = '✓'
    }
    current = k
    if (k === 'wake') { setArt('lofi'); say('Almost there. Just tuning in…') }
    if (k === 'firewall') { $('#inote', el).textContent = 'Windows asks once, so phones and TVs at home can reach Finesse. Choose Yes.'; say('One more permission, for your phones and TV. Yes, please!') }
  }
  const off = B.on('install', (d) => {
    mark(d.step)
    if (d.step === 'pull' && d.progress >= 0) {
      $('#s-pull .mini i', el).style.width = (d.progress * 100).toFixed(0) + '%'
      $('#s-pull .val', el).textContent = Math.round(d.progress * 100) + '%'
    }
  })
  try {
    const r = await B.call('installFinesse', { media: mediaChoice.path, port: 8080 })
    off()
    mark('firewall')
    const fw = await B.call('firewall', { port: r.port })
    $('#inote', el).textContent = ''
    mark('finish')
    await B.call('finish', { port: r.port })
    mark('done')
    busy = false
    await sleep(500)
    done(r, fw)
  } catch (e) { off(); busy = false; oops(e.message, install) }
}

function done(r, fw = { ok: true }) {
  const phone = r.lan || null
  const el = show(`
    <p class="kicker">All set</p>
    <h1>Finesse is <em>live</em>.</h1>
    <p class="lead" style="margin-bottom:12px">Finish setting it up in your browser: accounts, libraries, and downloads if you want them.</p>
    ${phone ? `<div class="small">On your phone or TV, at home:</div><div class="addr" title="${esc(phone)}">${esc(phone.replace(/^http:\/\//, '').replace(/\/$/, ''))}</div>` : ''}
    ${r.code ? `<div class="code">Setup code <b>${esc(r.code)}</b></div>` : ''}
    ${!fw.ok || info.networkPublic ? `<div class="note">${info.networkPublic ? 'Windows has this Wi-Fi set to <b>Public</b>, which hides this PC from other devices. In Settings → Network & internet, set it to <b>Private</b> so phones and TVs can reach Finesse.' : "Without the firewall permission, phones and TVs can't reach Finesse yet. Run Finesse Setup again any time to fix it."}</div>` : ''}
    <div class="actions"><button class="btn primary" id="open">Finish in your browser ${ARROW}</button>${phone && window.QR ? `<button class="btn ghost" id="phone">On your phone</button>` : ''}</div>
    <p class="small" style="margin-top:12px">It's in your Start menu as <b>Finesse</b>, and runs whenever Docker Desktop does (it starts when you sign in).</p>`,
  { art: 'done', line: 'We did it! Your own streaming service is live!', step: 4 })
  el.classList.add('finish')
  $('#phone', el)?.addEventListener('click', async () => {
    const svg = await window.QR.svg(phone)
    modal(`<div class="phone"><div class="qr">${svg}</div><div><h2>On your phone</h2><p>Point your phone's camera here, on the same Wi-Fi as this PC.</p><div class="addr">${esc(phone.replace(/^http:\/\//, '').replace(/\/$/, ''))}</div></div></div>
      <div class="actions"><button class="btn ghost" data-a="ok">Done</button></div>`)
  })
  $('#open', el).onclick = () => B.call('open', { url: r.url })
  if (!SELFTEST) setTimeout(confetti, 350)
}

function installedScreen() {
  const f = info.finesse
  const url = `http://localhost:${f.port}/finesse/`
  const el = show(`
    <p class="kicker">Welcome back</p>
    <h1>Finesse is <em>${f.running ? 'here' : 'resting'}</em>.</h1>
    <p class="lead">${f.running ? 'It\'s installed and running on this PC.' : 'It\'s installed, but stopped right now.'} Updates happen inside Finesse (Settings → Updates).</p>
    ${f.running && info.lan ? `<div class="small">On your phone or TV, at home:</div><div class="addr">${esc(info.lan)}:${f.port}/finesse</div>` : ''}
    <div class="actions">
      ${f.running ? `<button class="btn primary" id="open">Open Finesse ${ARROW}</button>` : `<button class="btn primary" id="start">Start Finesse ${ARROW}</button>`}
      <button class="btn ghost" id="un">Uninstall…</button>
    </div>
    ${f.running ? `<button class="link" id="fw" style="margin-top:14px">Phones or TVs can't reach it? Let them in again</button>` : ''}`,
  { art: 'welcome', line: f.running ? 'Welcome back! Everything is running.' : "Welcome back! Want me to start it up?", step: -1 })
  $('#open', el)?.addEventListener('click', () => B.call('open', { url: f.code ? `${url}setup?code=${encodeURIComponent(f.code)}` : url }))
  $('#start', el)?.addEventListener('click', async () => {
    busy = true
    say('On it!')
    try { await B.call('startFinesse'); busy = false; info = await B.call('info'); installedScreen() } catch (e) { busy = false; oops(e.message, installedScreen) }
  })
  $('#un', el).onclick = uninstallScreen
  $('#fw', el)?.addEventListener('click', async () => {
    say('Windows will ask. Say yes, and phones and TVs can come in.')
    const r = await B.call('firewall', { port: f.port }).catch(() => ({ ok: false }))
    say(r.ok ? (info.networkPublic ? "Done! One more thing: this Wi-Fi is set to Public in Windows. Set it to Private, too." : 'Done! Phones and TVs at home can reach Finesse now.') : "That didn't go through. Try again, and choose Yes when Windows asks.")
  })
}

function uninstallScreen() {
  const el = show(`
    <p class="kicker">Uninstall</p>
    <h1>Remove <em>Finesse</em>?</h1>
    <p class="lead">This removes Finesse and the apps it installed in Docker. Your movies, shows and music stay right where they are.</p>
    <label class="box"><input type="checkbox" id="del" /> Also delete Finesse's settings (accounts, app setup, watch history)</label>
    <div class="actions"><button class="btn danger" id="go">Uninstall</button><button class="btn ghost" id="keep">Keep Finesse</button></div>`,
  { art: 'oops', line: 'Leaving already? Your movies stay right where they are.', step: -1 })
  $('#keep', el).onclick = () => (info.finesse.installed ? installedScreen() : B.call('window', { action: 'close' }))
  $('#go', el).onclick = async () => {
    busy = true
    $('#go', el).disabled = true
    say('Packing up…')
    try {
      await B.call('uninstall', { deleteSettings: $('#del', el).checked })
      busy = false
      show(`<p class="kicker">Done</p><h1>Finesse is <em>gone</em>.</h1><p class="lead">Docker Desktop stays installed (other things may use it); remove it from Settings → Apps if you like.</p>
        <div class="actions"><button class="btn ghost" id="bye">Close</button></div>`, { art: 'lofi', line: 'Bye for now. Come back any time!' })
      $('#bye').onclick = () => B.call('window', { action: 'close' })
    } catch (e) { busy = false; oops(e.message, uninstallScreen) }
  }
}

async function oops(message, retry, detail) {
  const log = await B.call('log').catch(() => '')
  const el = show(`
    <p class="kicker">Hmm</p>
    <h1>That didn't <em>work</em>.</h1>
    <p class="lead">${esc(message)}</p>
    <details class="more"><summary>Details</summary><pre>${esc((detail ? detail + '\n\n' : '') + (log || ''))}</pre></details>
    <div class="actions">${retry ? `<button class="btn primary" id="retry">Try again ${ARROW}</button>` : ''}<button class="btn ghost" id="help">Get help</button></div>`,
  { art: 'oops', line: "Oops. Nothing's broken; let's sort it out together.", step: -1 })
  $('#retry', el)?.addEventListener('click', async () => { info = await B.call('info').catch(() => info); retry() })
  $('#help', el).onclick = () => B.call('open', { url: 'https://github.com/CoffeeCC/finesse/blob/master/docs/windows.md' })
}

// ---------- CI: draw every screen, one picture each ----------
async function selfTest() {
  const shot = async (name) => { await sleep(1400); await B.call('shot', { name }) }
  welcome(); await shot('1-welcome')
  await checks(); await shot('2-check')
  const realInfo = info
  info = { ...info, drives: info.drives.length ? info.drives : [{ letter: 'C', label: 'Windows', free: 120e9, total: 256e9, system: true }] }
  mediaChoice = { path: 'C:\\Finesse', ok: true, free: 120e9, linux: '/run/desktop/mnt/host/c/Finesse' }
  await folders(); await shot('3-folder')
  done({ port: 8080, code: 'K7QM-3XPD', url: 'http://localhost:8080/finesse/setup?code=K7QM-3XPD', lan: 'http://192.168.1.50:8080/finesse/' }); await shot('4-done')
  info = realInfo
  await oops('Docker Desktop didn\'t finish starting. (This is a test of the error screen.)', () => {}); await shot('5-oops')
  await B.call('quit', { code: 0 })
}

main()
