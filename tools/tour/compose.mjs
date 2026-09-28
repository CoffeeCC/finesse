// Assemble the tour film: desktop + phone (composited beside its captions) +
// TV + outro, with fades and chapter markers. Uses jellyfin-ffmpeg in Docker.
// node compose.mjs <desktopDir> <phoneDir> <tvDir> <outDir>
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { REPO, ff as ffIn, probe, voIndex } from './config.mjs'

const [DESK, PHONE, TV, OUT] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const ff = (args) => ffIn(args, OUT)

const FPS = 30
const MID = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS)]

// ---------- stills (Playwright, transparent where needed) ----------
const PX = 318, PY = 60, PW = 444, PH = 960
// The app's own fonts (from the web build), embedded so stills match the UI.
const ASSETS = join(REPO, 'dist/assets')
const font = (re) => {
  const f = execFileSync('ls', [ASSETS]).toString().split('\n').find((n) => re.test(n))
  return `data:font/woff2;base64,${readFileSync(join(ASSETS, f)).toString('base64')}`
}
const FONT = `@font-face{font-family:'Inter Variable';font-weight:100 900;src:url(${font(/^inter-latin-wght-normal-.*\.woff2$/)}) format('woff2')}
@font-face{font-family:'Instrument Serif';src:url(${font(/^instrument-serif-latin-400-normal-.*\.woff2$/)}) format('woff2')}`
const base = `${FONT}*{margin:0;box-sizing:border-box}html,body{width:1920px;height:1080px;font-family:'Inter Variable',system-ui,sans-serif;-webkit-font-smoothing:antialiased}`
const bgCss = `background:radial-gradient(ellipse at 22% 30%,#1f2748 0%,#10131d 45%,#0b0d12 75%)`
async function stills() {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
  const shot = async (name, html, transparent = false) => {
    await p.setContent(`<html><head><style>${base}</style></head><body${transparent ? '' : ` style="${bgCss}"`}>${html}</body></html>`)
    await p.evaluate(() => document.fonts.ready)
    await p.waitForTimeout(150)
    await p.screenshot({ path: join(OUT, name), omitBackground: transparent })
  }
  // Phone stage background: soft light behind the phone.
  await shot('phone-bg.png', `<div style="position:absolute;left:${PX - 180}px;top:${PY - 40}px;width:${PW + 360}px;height:${PH + 80}px;background:radial-gradient(ellipse,rgba(120,140,230,.22),transparent 65%)"></div>`)
  // Bezel: a black frame with rounded screen corners, over the video.
  await shot('phone-bezel.png', `<svg width="1920" height="1080" style="position:absolute;inset:0"><defs><mask id="m"><rect width="1920" height="1080" fill="white"/><rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="44" fill="black"/></mask></defs>
    <rect x="${PX - 14}" y="${PY - 14}" width="${PW + 28}" height="${PH + 28}" rx="58" fill="#050608" mask="url(#m)"/>
    <rect x="${PX - 14.5}" y="${PY - 14.5}" width="${PW + 29}" height="${PH + 29}" rx="58.5" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>
    <rect x="${PX + PW / 2 - 52}" y="${PY + 12}" width="104" height="28" rx="14" fill="#050608"/></svg>`, true)
  // Side captions.
  const caps = JSON.parse(readFileSync(join(PHONE, 'captions.json'), 'utf8')).filter((c) => c.title)
  for (const [i, c] of caps.entries()) {
    await shot(`phone-cap-${i}.png`, `<div style="position:absolute;left:900px;top:0;height:1080px;width:880px;display:flex;flex-direction:column;justify-content:center">
      <div style="font-size:22px;letter-spacing:.22em;text-transform:uppercase;color:#93a5e8;font-weight:600">On your phone</div>
      <div style="margin-top:18px;font-size:64px;line-height:1.08;font-weight:700;color:#fff;letter-spacing:-.015em">${c.title}</div>
      <div style="margin-top:22px;font-size:32px;line-height:1.45;color:#c9cedb;max-width:820px">${c.sub ?? ''}</div></div>`, true)
  }
  // Chapter card for the phone segment, and the outro.
  const card = (k, h, p, extra = '') => `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <div style="font-size:22px;letter-spacing:.24em;text-transform:uppercase;color:#93a5e8;font-weight:600">${k}</div>
    <div style="margin-top:18px;font-family:'Instrument Serif',Georgia,serif;font-size:118px;line-height:1;color:#fff">${h}</div>
    <div style="margin-top:26px;font-size:28px;color:#c9cedb;max-width:1100px;line-height:1.45">${p}</div>${extra}</div>`
  await shot('phone-card.png', card('On your phone', 'Finesse.', 'Phones and tablets get a touch-first layout, straight from the browser.'))
  const code = (t) => `<div style="margin-top:22px;font-family:ui-monospace,Menlo,monospace;font-size:24px;color:#e8ecf5;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 24px">${t}</div>`
  await shot('outro.png', card('Get Finesse', 'Finesse.', 'Your own streaming service, tonight. Free and self-hosted.',
    code('curl -fsSL https://raw.githubusercontent.com/CoffeeCC/finesse/master/install.sh | bash') +
    `<div style="margin-top:34px;font-size:26px;color:#c9cedb;line-height:1.6">Guides, the TV app and an install runbook for AI agents:<br><span style="color:#fff;font-weight:600">github.com/CoffeeCC/finesse</span></div>`))
  const line = (label, text) => `<div style="margin-top:22px"><div style="font-size:19px;letter-spacing:.2em;text-transform:uppercase;color:#93a5e8;font-weight:600">${label}</div><div style="margin-top:8px;font-size:25px;color:#e3e6ee;line-height:1.5">${text}</div></div>`
  await shot('credits.png', `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 200px">
    <div style="font-family:'Instrument Serif',Georgia,serif;font-size:72px;color:#fff">Credits</div>
    ${line('Films', 'Sintel, Elephants Dream, Big Buck Bunny, Tears of Steel and the Blender Studio shorts — Blender Foundation, CC BY.<br>Pioneer One — CC BY-NC-SA. The classic films and TV shows are in the public domain.')}
    ${line('Music', 'Jonathan Coulton, “Thing a Week Three” (incl. “Code Monkey”) — CC BY-NC.<br>Nine Inch Nails, “Ghosts I–IV” and “The Slip” — CC BY-NC-SA.')}
    ${line('Games', 'Tobu Tobu Girl, 2048, uCity, Aevilia, Apotris, Skyland, Thwaite and Concentration Room — free, open-source homebrew by their authors, via Homebrew Hub.')}
    ${line('Artwork, metadata and lyrics', 'TMDB (Finesse uses the TMDB API but is not endorsed or certified by TMDB), LRCLIB, and game details from RomM’s sources (Hasheous, IGDB, LaunchBox).')}
    ${line('Finesse runs on', 'Jellyfin, Sonarr, Radarr, Lidarr, Prowlarr, SABnzbd, qBittorrent, Gluetun, RomM and EmulatorJS — thank you to their authors.')}</div>`)
  await b.close()
  return caps
}

// ---------- segments ----------
// Slow-motion recordings (TOUR_SLOWMO=K) are sped back up to real time here.
const K = Math.max(1, Number(process.env.TOUR_SLOWMO || 1))
function framesToMp4(dir, out, vf = 'scale=1920:1080') {
  ff(['-f', 'concat', '-safe', '0', '-i', join(dir, 'frames', 'list.txt'), '-vf', `setpts=PTS/${K},fps=${FPS},${vf},format=yuv420p`, ...MID, out])
}
function still(png, secs, out) {
  ff(['-loop', '1', '-framerate', String(FPS), '-t', String(secs), '-i', png, '-vf', 'format=yuv420p', ...MID, out])
}

const caps = await stills()
console.log('stills ok')
const deskMp4 = join(OUT, 'seg-desktop.mp4')
if (!existsSync(deskMp4)) framesToMp4(DESK, deskMp4)
console.log('desktop ok')

// Phone: bg → phone video → bezel → captions (each fades in and out on its own layer).
const phoneRaw = join(OUT, 'phone-raw.mp4')
framesToMp4(PHONE, phoneRaw, `scale=${PW}:${PH}:flags=lanczos,setsar=1`)
const pDur = probe(phoneRaw)
const allCaps = JSON.parse(readFileSync(join(PHONE, 'captions.json'), 'utf8'))
const spans = []
for (let i = 0, k = 0; i < allCaps.length; i++) {
  if (!allCaps[i].title) continue
  const end = allCaps[i + 1]?.t ?? pDur
  spans.push({ k: k++, a: Math.max(0, allCaps[i].t), b: Math.min(pDur, end) })
}
const inputs = ['-loop', '1', '-framerate', String(FPS), '-i', join(OUT, 'phone-bg.png'), '-i', phoneRaw, '-loop', '1', '-framerate', String(FPS), '-i', join(OUT, 'phone-bezel.png')]
for (const s of spans) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', pDur.toFixed(2), '-i', join(OUT, `phone-cap-${s.k}.png`))
let g = `[0:v][1:v]overlay=${PX}:${PY}:shortest=1[a0];[a0][2:v]overlay=0:0:shortest=1[s0];`
spans.forEach((s, i) => {
  const fo = Math.max(s.a + 0.4, s.b - 0.35)
  g += `[${i + 3}:v]format=rgba,fade=t=in:st=${s.a.toFixed(2)}:d=0.4:alpha=1,fade=t=out:st=${fo.toFixed(2)}:d=0.35:alpha=1[c${i}];[s${i}][c${i}]overlay=0:0:shortest=1[s${i + 1}];`
})
g += `[s${spans.length}]format=yuv420p[v]`
const phoneMp4 = join(OUT, 'seg-phone.mp4')
ff([...inputs, '-filter_complex', g, '-map', '[v]', ...MID, phoneMp4])
const VOI = voIndex()
const voDur = (k) => VOI[`vo:${k}`]?.dur ?? 0
still(join(OUT, 'phone-card.png'), Math.max(3.4, voDur('phone-card') + 1.4), join(OUT, 'seg-phone-card.mp4'))
console.log('phone ok', caps.length, 'captions')

const tvMp4 = join(OUT, 'seg-tv.mp4')
framesToMp4(TV, tvMp4)
still(join(OUT, 'outro.png'), Math.max(7, voDur('outro') + 2.2), join(OUT, 'seg-outro.mp4'))
still(join(OUT, 'credits.png'), 8, join(OUT, 'seg-credits.mp4'))
console.log('tv + outro ok')

// ---------- join, with fades between segments, and chapters ----------
const segs = [deskMp4, join(OUT, 'seg-phone-card.mp4'), phoneMp4, tvMp4, join(OUT, 'seg-outro.mp4'), join(OUT, 'seg-credits.mp4')]
const durs = segs.map(probe)
const fin = []
let fg = ''
segs.forEach((s, i) => {
  fin.push('-i', s)
  const d = durs[i]
  fg += `[${i}:v]fade=t=in:st=0:d=0.45,fade=t=out:st=${(d - 0.45).toFixed(2)}:d=0.45,setsar=1[v${i}];`
})
fg += segs.map((_, i) => `[v${i}]`).join('') + `concat=n=${segs.length}:v=1:a=0[v]`

const NAMES = {
  intro: 'Welcome', wizard: 'Install and set up', build: 'Building your server', signin: 'Profiles and sign-in', home: 'Home',
  search: 'Search', detail: 'A title’s page', player: 'The player', shows: 'Movies and shows', request: 'Requests and downloads',
  music: 'Music and lyrics', games: 'Games', settings: 'Settings, your server and invites',
  groups: 'Groups: friends’ libraries',
}
const chapters = JSON.parse(readFileSync(join(DESK, 'chapters.json'), 'utf8')).map((c) => ({ title: NAMES[c.name] ?? c.name, t: c.t }))
let off = durs[0]
chapters.push({ title: 'On your phone', t: off })
off += durs[1] + durs[2]
chapters.push({ title: 'On your TV', t: off })
off += durs[3]
chapters.push({ title: 'Get Finesse', t: off })
off += durs[4]
chapters.push({ title: 'Credits', t: off })
const total = off + durs[5]
let meta = ';FFMETADATA1\ntitle=Finesse — the tour\n'
chapters.forEach((c, i) => {
  const end = chapters[i + 1]?.t ?? total
  meta += `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.t * 1000)}\nEND=${Math.round(end * 1000)}\ntitle=${c.title}\n`
})
writeFileSync(join(OUT, 'chapters.txt'), meta)
writeFileSync(join(OUT, 'chapters.json'), JSON.stringify(chapters.map((c) => ({ ...c, t: +c.t.toFixed(1) })), null, 1))

// ---------- audio: narration + sound effects + music bed (ducked under the voice) ----------
const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0))
const readCues = (dir) => (existsSync(join(dir, 'cues.json')) ? JSON.parse(readFileSync(join(dir, 'cues.json'), 'utf8')) : [])
const all = [
  ...readCues(DESK).map((c) => ({ ...c, t: c.t + starts[0] })),
  { kind: 'sfx', key: 'whoosh', t: starts[1] },
  { kind: 'vo', key: 'phone-card', t: starts[1] + 0.6 },
  ...readCues(PHONE).map((c) => ({ ...c, t: c.t + starts[2] })),
  ...readCues(TV).map((c) => ({ ...c, t: c.t + starts[3] })),
  { kind: 'sfx', key: 'whoosh', t: starts[4] },
  { kind: 'vo', key: 'outro', t: starts[4] + 0.8 },
  { kind: 'sfx', key: 'whoosh', t: starts[5] },
].filter((c) => VOI[`${c.kind}:${c.key}`] && c.t >= 0 && c.t < total)
const GAIN = { 'vo': 1.0, 'sfx:click': 0.32, 'sfx:key': 0.14, 'sfx:remote': 0.32, 'sfx:whoosh': 0.3, 'sfx:chime': 0.45 }
let audioIn = null
if (all.length) {
  const files = [...new Set(all.map((c) => VOI[`${c.kind}:${c.key}`].file))]
  const ain = files.flatMap((f) => ['-i', f])
  const bed = VOI['music:bed']
  const nb = bed ? Math.ceil(total / Math.max(30, bed.dur - 6)) + 1 : 0
  for (let i = 0; i < nb; i++) ain.push('-i', bed.file)
  let g = ''
  const uses = files.map((f) => all.filter((c) => VOI[`${c.kind}:${c.key}`].file === f))
  const labels = { vo: [], sfx: [] }
  uses.forEach((cs, i) => {
    g += cs.length > 1 ? `[${i}:a]asplit=${cs.length}${cs.map((_, j) => `[s${i}_${j}]`).join('')};` : `[${i}:a]anull[s${i}_0];`
    cs.forEach((c, j) => {
      const ms = Math.round(c.t * 1000)
      const gain = c.kind === 'vo' ? GAIN.vo : GAIN[`sfx:${c.key}`] ?? 0.3
      g += `[s${i}_${j}]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},volume=${gain}[${c.kind}${i}_${j}];`
      labels[c.kind].push(`[${c.kind}${i}_${j}]`)
    })
  })
  const bus = (name, ls) => (ls.length ? `${ls.join('')}amix=inputs=${ls.length}:normalize=0:dropout_transition=0,apad[${name}];` : `anullsrc=r=48000:cl=stereo[${name}];`)
  g += bus('vo', labels.vo) + bus('fx', labels.sfx)
  let out = '[vo][fx]amix=inputs=2:normalize=0[mixv]'
  if (bed) {
    // Loop the bed with long crossfades, fade it in and out, and duck it under the voice.
    const b0 = files.length
    const parts = Array.from({ length: nb }, (_, i) => `[${b0 + i}:a]aformat=sample_rates=48000:channel_layouts=stereo[b${i}]`).join(';')
    let xf = ''
    for (let i = 1; i < nb; i++) xf += `${i === 1 ? '[b0]' : `[x${i - 1}]`}[b${i}]acrossfade=d=6:c1=qsin:c2=qsin[x${i}];`
    const last = nb > 1 ? `[x${nb - 1}]` : '[b0]'
    g += `${parts};${xf}${last}atrim=0:${total.toFixed(2)},afade=t=in:d=2.5,afade=t=out:st=${(total - 5).toFixed(2)}:d=5,volume=0.2[bed];`
    g += `[vo]asplit=2[vo1][vo2];[bed][vo2]sidechaincompress=threshold=0.015:ratio=7:attack=40:release=900[bedd];`
    out = '[vo1][fx][bedd]amix=inputs=3:normalize=0[mixv]'
  }
  g += `${out};[mixv]atrim=0:${total.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
  writeFileSync(join(OUT, 'audio-graph.txt'), g)
  ff([...ain, '-filter_complex_script', join(OUT, 'audio-graph.txt'), '-map', '[aout]', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', join(OUT, 'tour-audio.m4a')])
  audioIn = join(OUT, 'tour-audio.m4a')
  console.log('audio ok', all.filter((c) => c.kind === 'vo').length, 'lines,', all.filter((c) => c.kind === 'sfx').length, 'sounds')
}
const aArgs = audioIn ? ['-i', audioIn] : []
const aMap = audioIn ? ['-map', `${segs.length + 1}:a`, '-c:a', 'copy'] : []

const enc = (out, vf, crf) => ff([...fin, '-i', join(OUT, 'chapters.txt'), ...aArgs, '-filter_complex', fg + (vf ? `;[v]${vf}[o]` : ''), '-map', vf ? '[o]' : '[v]', ...aMap, '-map_metadata', String(segs.length), '-map_chapters', String(segs.length),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS), '-movflags', '+faststart', out])
enc(join(OUT, 'finesse-tour.mp4'), null, 27)
enc(join(OUT, 'finesse-tour-720p.mp4'), 'scale=1280:720:flags=lanczos', 26)
ff(['-ss', String(Math.min(170, total / 2)), '-i', join(OUT, 'finesse-tour.mp4'), '-frames:v', '1', '-q:v', '3', join(OUT, 'poster-raw.jpg')])
console.log(JSON.stringify({ total: +total.toFixed(1), chapters: chapters.length }))
