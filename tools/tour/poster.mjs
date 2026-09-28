import { chromium } from 'playwright'
import { join } from 'node:path'
import { REPO } from './config.mjs'
import { readFileSync, readdirSync } from 'node:fs'
const A = join(REPO, 'dist/assets')
const f = (re) => `data:font/woff2;base64,${readFileSync(`${A}/${readdirSync(A).find((n) => re.test(n))}`).toString('base64')}`
const bg = readFileSync(process.argv[2]).toString('base64')
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
await p.setContent(`<style>@font-face{font-family:I;font-weight:100 900;src:url(${f(/^inter-latin-wght-normal-.*\.woff2$/)})}@font-face{font-family:S;src:url(${f(/^instrument-serif-latin-400-normal-.*\.woff2$/)})}
*{margin:0}body{width:1280px;height:720px;position:relative;overflow:hidden;font-family:I,sans-serif;background:#0b0d12}
.bg{position:absolute;inset:-12px;background:url(data:image/jpeg;base64,${bg}) center/cover;filter:saturate(1.05) blur(3px)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,13,18,.97) 0%,rgba(11,13,18,.9) 40%,rgba(11,13,18,.35) 72%,rgba(11,13,18,.12) 100%)}
.t{position:absolute;left:72px;top:50%;transform:translateY(-50%);color:#fff}
.k{font-size:17px;letter-spacing:.24em;text-transform:uppercase;color:#93a5e8;font-weight:600}
.h{font-family:S,serif;font-size:104px;line-height:1;margin-top:14px}.h b{color:#93a5e8;font-weight:400}
.p{margin-top:18px;font-size:24px;color:#d5d9e4;max-width:560px;line-height:1.4}
.play{margin-top:34px;display:inline-flex;align-items:center;gap:16px;background:#fff;color:#0b0d12;border-radius:999px;padding:14px 30px 14px 22px;font-weight:700;font-size:22px}
.play i{width:0;height:0;border-left:18px solid #0b0d12;border-top:11px solid transparent;border-bottom:11px solid transparent;margin-left:6px}
</style><div class=bg></div><div class=shade></div><div class=t><div class=k>${process.argv[4] || 'The tour'}</div><div class=h>Finesse<b>.</b></div>
<div class=p>Install it, set it up, and every feature on the web, your phone and the TV.</div><div class=play><i></i>Watch the tour</div></div>`)
await p.evaluate(() => document.fonts.ready)
await p.screenshot({ path: process.argv[3], type: 'jpeg', quality: 86 })
await b.close()
