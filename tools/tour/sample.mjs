// Quick sample: one recording dir → MP4 with narration, effects and music.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ff, voIndex } from './config.mjs'
const [DIR, OUT, K = '6'] = process.argv.slice(2)
const VOI = voIndex()
const cues = JSON.parse(readFileSync(join(DIR, 'cues.json'), 'utf8')).filter((c) => VOI[`${c.kind}:${c.key}`])
const lines = readFileSync(join(DIR, 'frames/list.txt'), 'utf8').split('\n')
const total = lines.filter((l) => l.startsWith('duration')).reduce((a, l) => a + Number(l.split(' ')[1]), 0) / Number(K)
const files = [...new Set(cues.map((c) => VOI[`${c.kind}:${c.key}`].file))]
const bed = VOI['music:bed'].file
let g = ''
const vo = [], fx = []
files.forEach((f, i) => {
  const cs = cues.filter((c) => VOI[`${c.kind}:${c.key}`].file === f)
  g += cs.length > 1 ? `[${i}:a]asplit=${cs.length}${cs.map((_, j) => `[s${i}_${j}]`).join('')};` : `[${i}:a]anull[s${i}_0];`
  cs.forEach((c, j) => {
    const ms = Math.round(c.t * 1000)
    const gain = c.kind === 'vo' ? 1 : { click: 0.32, key: 0.14, remote: 0.32, whoosh: 0.3, chime: 0.45 }[c.key] ?? 0.3
    g += `[s${i}_${j}]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},volume=${gain}[c${i}_${j}];`
    ;(c.kind === 'vo' ? vo : fx).push(`[c${i}_${j}]`)
  })
})
const b = files.length
g += `${vo.join('')}amix=inputs=${vo.length}:normalize=0,apad[vo];${fx.length ? `${fx.join('')}amix=inputs=${fx.length}:normalize=0,apad[fx]` : 'anullsrc=r=48000:cl=stereo[fx]'};`
g += `[${b}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${total.toFixed(2)},afade=t=in:d=2,afade=t=out:st=${(total - 3).toFixed(2)}:d=3,volume=0.2[bed];[vo]asplit=2[vo1][vo2];[bed][vo2]sidechaincompress=threshold=0.015:ratio=7:attack=40:release=900[bedd];[vo1][fx][bedd]amix=inputs=3:normalize=0,atrim=0:${total.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`
writeFileSync(join(DIR, 'sample-graph.txt'), g)
ff([...files.flatMap((f) => ['-i', f]), '-i', bed, '-f', 'concat', '-safe', '0', '-i', join(DIR, 'frames/list.txt'), '-filter_complex_script', join(DIR, 'sample-graph.txt'), '-map', `${b + 1}:v`, '-map', '[aout]',
  '-vf', `setpts=PTS/${K},fps=30,scale=1920:1080,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', OUT])
console.log('ok', total.toFixed(1), 's')
