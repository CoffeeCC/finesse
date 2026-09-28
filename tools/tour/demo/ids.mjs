// Writes <work>/ids.json: the demo items the tour opens by id.
//   node demo/ids.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEMO, IDS_FILE } from '../config.mjs'

const key = JSON.parse(readFileSync(join(DEMO, 'root/config/finesse/finesse.json'), 'utf8')).jellyfin.apiKey
const jf = async (path) => {
  const r = await fetch(`http://localhost:8080/jellyfin${path}`, { headers: { Authorization: `MediaBrowser Token="${key}"` } })
  if (!r.ok) throw new Error(`Jellyfin answered ${r.status} for ${path}`)
  return r.json()
}
const WANT = [
  ['Sintel', 'Movie'], ['Big Buck Bunny', 'Movie'], ['Elephants Dream', 'Movie'], ['Metropolis', 'Movie'],
  ['Pioneer One', 'Series'], ['Thing a Week Three', 'MusicAlbum'], ['The Slip', 'MusicAlbum'],
  ['Code Monkey', 'Audio'], ['Discipline', 'Audio'],
]
const ids = {}
for (const [name, type] of WANT) {
  const r = await jf(`/Items?Recursive=true&IncludeItemTypes=${type}&searchTerm=${encodeURIComponent(name)}&Limit=5`)
  const hit = r.Items.find((i) => i.Name === name) ?? r.Items[0]
  if (!hit) throw new Error(`Couldn't find “${name}” on the demo server — has the library finished scanning?`)
  ids[name] = hit.Id
}
writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1))
console.log(`${Object.keys(ids).length} ids → ${IDS_FILE}`)
