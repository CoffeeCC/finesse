// chapters.json → a markdown list of "m:ss Title" for the README.
import { readFileSync } from 'node:fs'
const ch = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ts = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
console.log(ch.map((c) => `\`${ts(c.t)}\` ${c.title}`).join(' · '))
