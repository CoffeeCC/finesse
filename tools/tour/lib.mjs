// Tour recording toolkit: CDP screencast capture (crisp frames, real timing),
// an on-page cursor + click ripples, lower-third captions, chapter cards and
// remote-key hints. Everything visual is injected into the page, so what's
// captured is exactly what viewers see.
import { chromium } from 'playwright'
import { CHROME, DEMO, VO_DIR, WORK } from './config.mjs'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileP = promisify(execFile)
const CACHE = join(WORK, 'cache')
import { join } from 'node:path'

export function OVERLAY() {
  if (window.__tour) return
  const css = `
  .grain,.aurora{display:none!important}
  #__t_root{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:Inter,'Inter Variable',system-ui,sans-serif}
  #__t_cursor{position:fixed;left:0;top:0;width:26px;height:26px;transform:translate(-3px,-2px);transition:opacity .3s;opacity:0;filter:drop-shadow(0 2px 6px rgba(0,0,0,.55))}
  .__t_ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(255,255,255,.9);background:rgba(255,255,255,.18);animation:__t_rip .55s ease-out forwards}
  @keyframes __t_rip{from{transform:scale(.35);opacity:1}to{transform:scale(1.25);opacity:0}}
  #__t_cap{position:fixed;left:56px;bottom:56px;max-width:980px;display:flex;gap:18px;align-items:stretch;opacity:0;transform:translateY(14px);transition:opacity .45s ease,transform .45s cubic-bezier(.22,1,.36,1)}
  #__t_cap.on{opacity:1;transform:none}
  #__t_cap .bar{width:5px;border-radius:4px;background:linear-gradient(#93a5e8,#6279cd)}
  #__t_cap .box{background:rgba(11,13,18,.9);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:16px 22px;box-shadow:0 18px 50px rgba(0,0,0,.45)}
  #__t_cap .t{font-size:30px;font-weight:700;color:#fff;letter-spacing:-.01em;line-height:1.2}
  #__t_cap .s{margin-top:6px;font-size:21px;color:#c9cedb;line-height:1.4}
  #__t_card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(ellipse at 30% 20%,#1d2440 0%,#0b0d12 60%);opacity:0;transition:opacity .5s ease}
  #__t_card.on{opacity:1}
  #__t_card .k{font-size:22px;letter-spacing:.24em;text-transform:uppercase;color:#93a5e8;font-weight:600}
  #__t_card .h{margin-top:18px;font-family:'Instrument Serif',Georgia,serif;font-size:118px;line-height:1;color:#fff}
  #__t_card .p{margin-top:26px;font-size:28px;color:#c9cedb;max-width:1100px;line-height:1.45}
  #__t_card .code{margin-top:34px;font-family:ui-monospace,Menlo,monospace;font-size:26px;color:#e8ecf5;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:16px 26px}
  #__t_key{position:fixed;right:56px;bottom:56px;display:flex;align-items:center;gap:12px;opacity:0;transition:opacity .25s}
  #__t_key.on{opacity:1}
  #__t_key .pad{width:64px;height:64px;border-radius:50%;background:rgba(11,13,18,.85);border:2px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.5)}
  #__t_key .lbl{font-size:18px;color:#c9cedb;background:rgba(11,13,18,.8);padding:6px 12px;border-radius:10px}
  `
  const mount = () => {
    if (document.getElementById('__t_root')) return
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
    const root = document.createElement('div'); root.id = '__t_root'
    root.innerHTML = '<svg id="__t_cursor" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.4 3 6.7 3-1.3-3-6.6 6.4-.3z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>'
      + '<div id="__t_cap"><div class="bar"></div><div class="box"><div class="t"></div><div class="s"></div></div></div>'
      + '<div id="__t_card"><div class="k"></div><div class="h"></div><div class="p"></div></div>'
      + '<div id="__t_key"><div class="pad"></div><div class="lbl"></div></div>'
    document.documentElement.appendChild(root)
  }
  const $ = (id) => { mount(); return document.getElementById(id) }
  let capTimer = 0, keyTimer = 0
  window.__tour = {
    cursor(x, y, show = true, ms = 0) { const c = $('__t_cursor'); c.style.transition = ms ? 'left ' + ms + 'ms cubic-bezier(.65,0,.35,1), top ' + ms + 'ms cubic-bezier(.65,0,.35,1), opacity .3s' : 'opacity .3s'; c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.opacity = show ? '1' : '0' },
    hideCursor() { $('__t_cursor').style.opacity = '0' },
    ripple(x, y) { mount(); const r = document.createElement('div'); r.className = '__t_ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.getElementById('__t_root').appendChild(r); setTimeout(() => r.remove(), 700) },
    caption(t, s, ms) { const c = $('__t_cap'); c.querySelector('.t').textContent = t; c.querySelector('.s').textContent = s || ''; c.querySelector('.s').style.display = s ? '' : 'none'; c.classList.add('on'); clearTimeout(capTimer); if (ms) capTimer = setTimeout(() => c.classList.remove('on'), ms) },
    clear() { $('__t_cap').classList.remove('on') },
    card(k, h, p, code) { const c = $('__t_card'); c.querySelector('.k').textContent = k || ''; c.querySelector('.h').textContent = h || ''; const pe = c.querySelector('.p'); pe.textContent = p || ''; let ce = c.querySelector('.code'); if (code) { if (!ce) { ce = document.createElement('div'); ce.className = 'code'; c.appendChild(ce) } ce.textContent = code } else if (ce) ce.remove(); c.classList.add('on') },
    uncard() { $('__t_card').classList.remove('on') },
    key(sym, label) { const k = $('__t_key'); k.querySelector('.pad').textContent = sym; k.querySelector('.lbl').textContent = label || ''; k.querySelector('.lbl').style.display = label ? '' : 'none'; k.classList.add('on'); clearTimeout(keyTimer); keyTimer = setTimeout(() => k.classList.remove('on'), 700) },
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount()
}


/** Runs in the page: dilate time by K (see K below). */
function SLOWMO(K) {
  const rNow = performance.now.bind(performance)
  const base = rNow()
  performance.now = () => base + (rNow() - base) / K
  const rDate = Date.now
  const dBase = rDate()
  Date.now = () => dBase + (rDate() - dBase) / K
  const sT = window.setTimeout
  const sI = window.setInterval
  window.setTimeout = (fn, ms, ...a) => sT(fn, (Number(ms) || 0) * K, ...a)
  window.setInterval = (fn, ms, ...a) => sI(fn, (Number(ms) || 0) * K, ...a)
  // Frame callbacks get the dilated clock. (Their own timestamp comes from the
  // animation clock, which Animation.setPlaybackRate already slows.)
  // With window.__tourGameClock set, frames are handed out at 60 per second of
  // the slowed clock: things that count frames instead of reading the clock
  // (an emulator) then also run K× slower, like everything else.
  const rAF = window.requestAnimationFrame.bind(window)
  const cAF = window.cancelAnimationFrame.bind(window)
  const live = new Map()
  let seq = 0, frameTs = -1, open = true, nextOpen = 0
  const gate = (ts) => {
    if (ts === frameTs) return open
    frameTs = ts
    if (!window.__tourGameClock) return (open = true)
    const now = performance.now()
    if (now + 0.5 < nextOpen) return (open = false)
    nextOpen = Math.max(nextOpen + 1000 / 60, now - 50)
    window.__tourGameFrames = (window.__tourGameFrames || 0) + 1
    return (open = true)
  }
  window.requestAnimationFrame = (cb) => {
    const id = ++seq
    const step = (ts) => {
      if (!gate(ts)) return void live.set(id, rAF(step))
      live.delete(id)
      cb(performance.now())
    }
    live.set(id, rAF(step))
    return id
  }
  window.cancelAnimationFrame = (id) => {
    const r = live.get(id)
    if (r !== undefined) cAF(r)
    live.delete(id)
  }
  // Media plays K× slower; the page still sees the rate it asked for.
  const P = HTMLMediaElement.prototype
  const rate = Object.getOwnPropertyDescriptor(P, 'playbackRate')
  const drate = Object.getOwnPropertyDescriptor(P, 'defaultPlaybackRate')
  const want = new WeakMap()
  Object.defineProperty(P, 'playbackRate', { configurable: true, get() { return want.get(this) ?? 1 }, set(v) { want.set(this, v); rate.set.call(this, v / K) } })
  Object.defineProperty(P, 'defaultPlaybackRate', { configurable: true, get() { return drate.get.call(this) * K }, set(v) { drate.set.call(this, v / K) } })
  const fix = (e) => {
    const m = e.target
    if (!(m instanceof HTMLMediaElement)) return
    const target = (want.get(m) ?? 1) / K
    if (Math.abs(rate.get.call(m) - target) > 1e-6) rate.set.call(m, target)
    if (Math.abs(drate.get.call(m) - 1 / K) > 1e-6) drate.set.call(m, 1 / K)
  }
  for (const ev of ['loadstart', 'loadedmetadata', 'play', 'playing']) document.addEventListener(ev, fix, true)
}

export async function launch() {
  return chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] })
}

export async function newStage(browser, opts = {}) {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 1920, height: opts.height ?? 1080 }, deviceScaleFactor: opts.dpr ?? 1, ignoreHTTPSErrors: true, userAgent: opts.userAgent, isMobile: opts.isMobile, hasTouch: opts.hasTouch, reducedMotion: 'no-preference' })
  if (opts.overlay !== false) await context.addInitScript(OVERLAY)
  // Show the demo's folders as the paths a real install would use, and its
  // local ports as a typical home server's address.
  await context.addInitScript((demo) => {
    const pairs = [
      [demo + '/wizard/data', '/srv/media'], [demo + '/wizard/root', '/opt/finesse'],
      [demo + '/data', '/srv/media'], [demo + '/root', '/opt/finesse'],
      ['localhost:8080', '192.168.1.50:8080'], ['localhost:8091', '192.168.1.50:8080'], ['localhost:8096', '192.168.1.50:8096'],
    ]
    const needs = (t) => t.includes(demo) || t.includes('localhost:80')
    const swap = (t) => pairs.reduce((x, [a, b]) => x.split(a).join(b), t)
    const fix = (n) => {
      if (n.nodeType === 3) {
        // Only write on a real change: any write queues another mutation.
        if (needs(n.data)) { const v = swap(n.data); if (v !== n.data) n.data = v }
      } else if (n.nodeType === 1) {
        if (n.title && needs(n.title)) { const v = swap(n.title); if (v !== n.title) n.title = v }
        if (n.tagName === 'INPUT' && n.value?.includes(demo)) { const v = swap(n.value); if (v !== n.value) n.value = v }
        for (const c of n.childNodes) fix(c)
      }
    }
    new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') fix(m.target); else m.addedNodes.forEach(fix) } })
      .observe(document, { subtree: true, childList: true, characterData: true })
  }, DEMO)
  // No idle screensaver while recording (it would cover the tour during pauses).
  await context.addInitScript(() => {
    try {
      const k = 'finesse.prefs'
      const p = JSON.parse(localStorage.getItem(k) || '{}')
      if (p.screensaver !== false) localStorage.setItem(k, JSON.stringify({ ...p, screensaver: false }))
    } catch {}
  })
  // Outside resources (lyrics, posters in request results) are fetched once
  // with curl and cached: every take shows the same thing, and it also works
  // behind a proxy the browser can't use.
  await context.route(/^https:\/\/(?!localhost|127\.)/, async (route) => {
    const url = route.request().url()
    const key = join(CACHE, createHash('sha1').update(url).digest('hex'))
    try {
      if (!existsSync(key)) {
        mkdirSync(CACHE, { recursive: true })
        const tmp = `${key}.${process.pid}.tmp`
        const ctype = (await execFileP('curl', ['-sf', '-m', '25', '-L', '-o', tmp, '-w', '%{content_type}', url])).stdout || 'application/octet-stream'
        writeFileSync(`${key}.type`, ctype)
        renameSync(tmp, key)
      }
      await route.fulfill({ status: 200, contentType: readFileSync(`${key}.type`, 'utf8'), body: readFileSync(key), headers: { 'access-control-allow-origin': '*' } })
    } catch {
      await route.abort().catch(() => {})
    }
  })
  if (K > 1) await context.addInitScript(SLOWMO, K)
  const page = await context.newPage()
  if (K > 1) {
    page.setDefaultTimeout(30000 * K)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Animation.enable')
    const slow = () => cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / K }).catch(() => {})
    await slow()
    page.on('framenavigated', (f) => f === page.mainFrame() && void slow())
  }
  return { context, page }
}

/** Screencast recorder: every frame Chrome paints, with its timestamp. */
export class Recorder {
  constructor(page, dir) {
    this.page = page
    this.dir = dir
    this.frames = []
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }
  async start(w = 1920, h = 1080) {
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', async (f) => {
      const name = `f${String(this.frames.length).padStart(6, '0')}.jpg`
      writeFileSync(join(this.dir, name), Buffer.from(f.data, 'base64'))
      this.frames.push([name, f.metadata.timestamp])
      await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: w, maxHeight: h, everyNthFrame: 1 })
    this.t0 = Date.now()
  }
  async stop() {
    await this.cdp.send('Page.stopScreencast').catch(() => {})
    const end = this.frames.length ? this.frames.at(-1)[1] + 0.5 : 0
    const lines = ['ffconcat version 1.0']
    this.frames.forEach(([name, ts], i) => {
      const next = i + 1 < this.frames.length ? this.frames[i + 1][1] : end
      lines.push(`file '${name}'`, `duration ${Math.max(0.001, next - ts).toFixed(4)}`)
    })
    if (this.frames.length) lines.push(`file '${this.frames.at(-1)[0]}'`)
    writeFileSync(join(this.dir, 'list.txt'), lines.join('\n') + '\n')
    return { frames: this.frames.length, seconds: this.frames.length ? end - this.frames[0][1] : 0, t0: this.frames[0]?.[1] }
  }
}

// ---------- choreography helpers ----------

// Slow-motion capture: with TOUR_SLOWMO=K the page runs K× slower (clocks,
// timers, animations, media) and every pause here is K× longer; compose.mjs
// speeds the frames back up, so a page that only renders 6 fps comes out smooth.
export const K = Math.max(1, Number(process.env.TOUR_SLOWMO || 1))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms * K))

// Narration + sound cues. A spoken line starts with its caption, and the next
// caption waits until it has finished, so the picture never runs ahead of the
// voice. Every line and sound is logged (real time) for compose.mjs to mix.
const VOI = (() => {
  try {
    return process.env.TOUR_VO === '0' ? {} : JSON.parse(readFileSync(join(VO_DIR, 'index.json'), 'utf8'))
  } catch {
    return {}
  }
})()
export const cues = []
const rsleep = (ms) => new Promise((r) => setTimeout(r, ms))
let voEnd = 0
export async function voWait() {
  const left = voEnd - Date.now()
  if (left > 0) await rsleep(left)
}
/** Speak the line for `key` (if there is one), after the previous line and a breath. */
export async function say(key) {
  const v = VOI[`vo:${key}`]
  if (!v) return false
  const gap = voEnd + 450 * K - Date.now()
  if (voEnd && gap > 0) await rsleep(gap)
  cues.push({ kind: 'vo', key, at: Date.now() / 1000 })
  voEnd = Date.now() + v.dur * 1000 * K
  return true
}
export const sfx = (key) => void cues.push({ kind: 'sfx', key, at: Date.now() / 1000 })
/** Cue times relative to the recording's first frame, in (sped-up) video seconds. */
export const cueTimes = (t0) => cues.map((c) => ({ kind: c.kind, key: c.key, t: +((c.at - t0) / K).toFixed(3) }))

export function director(page) {
  let cx = 960, cy = 540
  const ov = (fn, ...a) => page.evaluate(([f, args]) => window.__tour?.[f]?.(...args), [fn, a]).catch(() => {})
  const d = {
    async move(x, y, ms = 650) {
      // The cursor glides with a CSS transition (smooth on video); the real
      // mouse follows in a few steps so hover effects fire along the way.
      await ov('cursor', x, y, true, ms)
      const steps = 4
      const sx = cx, sy = cy
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        await sleep(ms / steps)
        await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e)
      }
      cx = x; cy = y
    },
    async hover(loc, ms) {
      const t0 = Date.now()
      await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
      const b = await loc.boundingBox({ timeout: 10000 })
      if (Date.now() - t0 > 1500) console.log(`  (slow locate ${Date.now() - t0}ms: ${loc})`)
      if (!b) throw new Error('no box for hover')
      await d.move(b.x + b.width / 2, b.y + b.height / 2, ms)
      return b
    },
    async click(loc, opts = {}) {
      const b = await d.hover(loc, opts.ms)
      await sleep(opts.pause ?? 220)
      await ov('ripple', b.x + b.width / 2, b.y + b.height / 2)
      sfx('click')
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
      await sleep(opts.after ?? 600)
    },
    async clickAt(x, y, opts = {}) {
      await d.move(x, y, opts.ms)
      await sleep(opts.pause ?? 220)
      await ov('ripple', x, y)
      sfx('click')
      await page.mouse.click(x, y)
      await sleep(opts.after ?? 600)
    },
    async type(text, delay = 70) {
      for (const ch of text) {
        sfx('key')
        await page.keyboard.type(ch)
        await sleep(delay + Math.random() * 40)
      }
    },
    async key(k, sym, label, after = 520) {
      await ov('key', sym, label)
      sfx('remote')
      await page.keyboard.press(k)
      await sleep(after)
    },
    async caption(t, s, ms) {
      await say(t)
      await ov('caption', t, s, ms)
    },
    async clear() {
      await voWait()
      await ov('clear')
    },
    async card(k, h, p, code, ms = 3200) {
      sfx('whoosh')
      await say(`${k}|${h}`)
      await ov('card', k, h, p, code)
      await sleep(ms)
    },
    uncard: () => ov('uncard'),
    hideCursor: () => ov('hideCursor'),
    async showCursor() { await ov('cursor', cx, cy) },
    async scroll(dy, ms = 900) {
      // Eased in-page scroll: smooth on video, and no per-step round trips.
      await page.evaluate(([dy, ms, x, y]) => new Promise((done) => {
        // Whatever scrolls under the cursor (a panel), else the page.
        let el = document.elementFromPoint(x, y)
        while (el && !(el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement
        if (!el || el === document.body) el = document.scrollingElement || document.documentElement
        const from = el.scrollTop, t0 = performance.now()
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms)
          el.scrollTo({ top: from + dy * ease(t), behavior: 'instant' })
          if (t < 1) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      }), [dy, ms, cx, cy]).catch(() => {})
    },
  }
  if (process.env.TOUR_DEBUG) {
    for (const [k, fn] of Object.entries(d)) {
      d[k] = async (...a) => {
        const t = Date.now()
        const r = await fn(...a)
        console.log(`  ${k} ${Date.now() - t}ms`)
        return r
      }
    }
  }
  return d
}
