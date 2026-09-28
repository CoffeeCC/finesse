// Cuts the finished tour into short episodes you can release one at a time.
// Each one: a title card, its chapters of the film (narration, effects and music
// as mixed), and the "Get Finesse" end card with a spoken call to action.
// node episodes.mjs <filmDir> <outDir>
//   filmDir: compose.mjs output (finesse-tour.mp4, chapters.json, outro.png)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { REPO, VO_DIR, ff as ffIn, probe, voIndex } from './config.mjs'

const [FILM, OUT] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const ff = (args) => ffIn(args, OUT)

// Episodes, by the film's chapter titles: [from, until) — until is the next episode's start.
const EPISODES = [
  { slug: 'install', title: 'Install & set up', sub: 'One command, then a setup page that builds your whole server.', from: 'Welcome', until: 'Profiles and sign-in' },
  { slug: 'home', title: 'Home & profiles', sub: 'A profile for everyone, and a Home that knows what you’re watching.', from: 'Profiles and sign-in', until: 'Search' },
  { slug: 'search', title: 'Search & title pages', sub: 'Find anything as you type. Every title gets a page of its own.', from: 'Search', until: 'The player' },
  { slug: 'player', title: 'The player', sub: 'Subtitles, previews as you scrub, and the next episode lined up.', from: 'The player', until: 'Requests and downloads' },
  { slug: 'requests', title: 'Requests', sub: 'Don’t have it? Request it, and Finesse gets it for you.', from: 'Requests and downloads', until: 'Music and lyrics' },
  { slug: 'music', title: 'Music & lyrics', sub: 'A proper music player, with lyrics that follow the song.', from: 'Music and lyrics', until: 'Games' },
  { slug: 'games', title: 'Games', sub: 'Your retro collection, right next to your movies.', from: 'Games', until: 'Settings, your server and invites' },
  { slug: 'server', title: 'Your server & invites', sub: 'Make it yours, keep an eye on everything, and invite people.', from: 'Settings, your server and invites', until: 'On your phone' },
  { slug: 'phone', title: 'On your phone', sub: 'The same Finesse, made for thumbs.', from: 'On your phone', until: 'On your TV' },
  { slug: 'tv', title: 'On your TV', sub: 'Made for the remote, on LG TVs and any TV’s browser.', from: 'On your TV', until: 'Get Finesse' },
]
const TITLE_S = 3.2
const END_S = 5.2

const chapters = JSON.parse(readFileSync(join(FILM, 'chapters.json'), 'utf8'))
const at = (title) => {
  const c = chapters.find((x) => x.title === title)
  if (!c) throw new Error(`no chapter “${title}” in ${FILM}/chapters.json`)
  return c.t
}
const film = join(FILM, 'finesse-tour.mp4')
const filmDur = probe(film)
const VOI = voIndex()
const bed = VOI['music:bed']?.file
const whoosh = VOI['sfx:whoosh']?.file
const cta = VOI['vo:episode-outro']?.file ?? null

// ---------- title cards ----------
const ASSETS = join(REPO, 'dist/assets')
const font = (re) => `data:font/woff2;base64,${readFileSync(join(ASSETS, readdirSync(ASSETS).find((n) => re.test(n)))).toString('base64')}`
const FONT = `@font-face{font-family:'Inter Variable';font-weight:100 900;src:url(${font(/^inter-latin-wght-normal-.*\.woff2$/)}) format('woff2')}
@font-face{font-family:'Instrument Serif';src:url(${font(/^instrument-serif-latin-400-normal-.*\.woff2$/)}) format('woff2')}`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
for (const [i, e] of EPISODES.entries()) {
  const n = String(i + 1).padStart(2, '0')
  // A still from the episode, framed like a screen: of a few candidates, the
  // most detailed one (the biggest JPEG), so it's never a blank or fading frame.
  const a = at(e.from), z = e.until ? at(e.until) : filmDur
  let best = null
  for (const f of e.still ? [e.still] : [0.35, 0.45, 0.55, 0.65, 0.75]) {
    const file = join(OUT, `still-${n}-${Math.round(f * 100)}.jpg`)
    ff(['-ss', (a + (z - a) * f).toFixed(2), '-i', film, '-frames:v', '1', '-q:v', '2', file])
    const size = statSync(file).size
    if (!best || size > best.size) best = { file, size }
  }
  const still = readFileSync(best.file).toString('base64')
  await p.setContent(`<style>${FONT}*{margin:0}body{width:1920px;height:1080px;font-family:'Inter Variable',sans-serif;background:radial-gradient(ellipse at 22% 30%,#1f2748 0%,#10131d 45%,#0b0d12 75%);-webkit-font-smoothing:antialiased}</style>
  <img src="data:image/jpeg;base64,${still}" style="position:absolute;right:120px;top:50%;transform:translateY(-50%);width:820px;height:461px;object-fit:cover;border-radius:22px;border:1px solid rgba(255,255,255,.12);box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 10px rgba(255,255,255,.03)">
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 1040px 0 150px">
    <div style="font-size:24px;letter-spacing:.26em;text-transform:uppercase;color:#93a5e8;font-weight:600">Finesse · ${n}</div>
    <div style="margin-top:20px;font-family:'Instrument Serif',Georgia,serif;font-size:112px;line-height:1.02;color:#fff">${e.title}</div>
    <div style="margin-top:28px;font-size:32px;color:#c9cedb;line-height:1.42">${e.sub}</div>
  </div>`)
  await p.evaluate(() => document.fonts.ready)
  await p.screenshot({ path: join(OUT, `card-${n}.png`) })
}
await b.close()
if (process.env.CARDS_ONLY) process.exit(0)

// ---------- episodes ----------
const V = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '30']
const A = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
const list = []
for (const [i, e] of EPISODES.entries()) {
  const n = String(i + 1).padStart(2, '0')
  const a = at(e.from)
  const z = e.until ? at(e.until) : filmDur
  const len = z - a
  const outFile = join(OUT, `finesse-${n}-${e.slug}.mp4`)
  // Inputs: 0 title card, 1 film, 2 end card, 3 bed (card music), 4 whoosh, [5 call to action]
  const inputs = ['-loop', '1', '-framerate', '30', '-t', String(TITLE_S), '-i', join(OUT, `card-${n}.png`),
    '-ss', a.toFixed(2), '-t', len.toFixed(2), '-i', film,
    '-loop', '1', '-framerate', '30', '-t', String(END_S), '-i', join(FILM, 'outro.png'),
    '-ss', '24', '-i', bed, '-i', whoosh, ...(cta ? ['-i', cta] : [])]
  const T = TITLE_S, E = END_S
  let g = ''
  g += `[0:v]fade=t=in:st=0:d=0.5,fade=t=out:st=${T - 0.4}:d=0.4,setsar=1,format=yuv420p[v0];`
  g += `[1:v]fade=t=in:st=0:d=0.35,fade=t=out:st=${(len - 0.45).toFixed(2)}:d=0.45,setsar=1,format=yuv420p[v1];`
  g += `[2:v]fade=t=in:st=0:d=0.4,fade=t=out:st=${E - 0.8}:d=0.8,setsar=1,format=yuv420p[v2];`
  // Card music: the bed fades up under the title card and back in under the end card.
  g += `[3:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[b0][b1];`
  g += `[b0]atrim=0:${T},asetpts=PTS-STARTPTS,afade=t=in:d=0.8,afade=t=out:st=${T - 0.6}:d=0.6,volume=0.22[m0];`
  g += `[b1]atrim=40:${40 + E},asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st=${E - 1.4}:d=1.4,volume=0.22[m2];`
  g += `[4:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[w0][w2];[w0]volume=0.3[w0v];[w2]volume=0.3[w2v];`
  g += `[m0][w0v]amix=inputs=2:normalize=0,atrim=0:${T}[a0];`
  g += `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=0.3,afade=t=out:st=${(len - 0.6).toFixed(2)}:d=0.6[a1];`
  g += cta
    ? `[5:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=500|500[c2];[m2][w2v][c2]amix=inputs=3:normalize=0,apad,atrim=0:${E}[a2];`
    : `[m2][w2v]amix=inputs=2:normalize=0,apad,atrim=0:${E}[a2];`
  g += `[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][araw];[araw]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`
  writeFileSync(join(OUT, `graph-${n}.txt`), g)
  ff([...inputs, '-filter_complex_script', join(OUT, `graph-${n}.txt`), '-map', '[v]', '-map', '[a]', ...V, ...A,
    '-metadata', `title=Finesse · ${e.title}`, '-movflags', '+faststart', outFile])
  const dur = probe(outFile)
  list.push({ n, ...e, file: outFile.split('/').pop(), dur: +dur.toFixed(1) })
  console.log(`✔ ${n} ${e.title} (${dur.toFixed(1)} s)`)
}
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`
writeFileSync(join(OUT, 'episodes.json'), JSON.stringify(list, null, 1))
writeFileSync(join(OUT, 'EPISODES.md'), `# Finesse — the tour in episodes\n\n| # | Episode | Length | File |\n|---|---|---|---|\n${list.map((x) => `| ${x.n} | **${x.title}** — ${x.sub} | ${mmss(x.dur)} | \`${x.file}\` |`).join('\n')}\n`)
console.log('episodes ok →', OUT)
