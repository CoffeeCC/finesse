// ElevenLabs assets for the tour: narration (one clip per caption beat), a few
// UI sound effects and a music bed. Cached by content hash, so re-runs only
// pay for what changed. Writes <work>/vo/index.json: { key: { file, dur } }.
//   ELEVENLABS_API_KEY=… node vo.mjs [voices|sfx|music|all]
// The key is only read from the environment: never put it in a file in the repo.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, VO_DIR, probe } from './config.mjs'

const DIR = VO_DIR
mkdirSync(DIR, { recursive: true })
const KEY = (process.env.ELEVENLABS_API_KEY || '').trim()
if (!KEY) {
  console.error('Set ELEVENLABS_API_KEY (an ElevenLabs API key with text-to-speech, sound effects and music).')
  process.exit(1)
}
const API = 'https://api.elevenlabs.io'
const VOICE = process.env.VO_VOICE || 'hpp4J3VqNfWAUOO0d1Us' // Bella — professional, bright, warm
const MODEL = 'eleven_multilingual_v2'
const what = process.argv[2] || 'all'

const hash = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12)
const dur = (file) => probe(file)

async function post(path, body, out) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) })
    if (r.ok) {
      writeFileSync(out, Buffer.from(await r.arrayBuffer()))
      return
    }
    const t = await r.text()
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 2000 * attempt))
      continue
    }
    throw new Error(`${path} → ${r.status}: ${t.slice(0, 300)}`)
  }
  throw new Error(`${path}: gave up after retries`)
}

const indexFile = join(DIR, 'index.json')
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {}
const save = () => writeFileSync(indexFile, JSON.stringify(index, null, 1))

async function asset(key, spec, make) {
  const h = hash(spec)
  const file = join(DIR, `${key.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}-${h}.mp3`)
  if (!existsSync(file)) {
    await make(file)
    console.log('made', key)
  }
  index[key] = { file, dur: +dur(file).toFixed(3) }
  save()
}

if (what === 'voices' || what === 'all') {
  const lines = JSON.parse(readFileSync(join(HERE, 'narration.json'), 'utf8'))
  const keys = Object.keys(lines)
  // A few at a time (the Starter plan allows a handful of concurrent requests).
  for (let i = 0; i < keys.length; i += 3) {
    await Promise.all(keys.slice(i, i + 3).map((k, j) => {
      const text = lines[k]
      const prev = lines[keys[i + j - 1]]
      const next = lines[keys[i + j + 1]]
      const body = { text, model_id: MODEL, previous_text: prev, next_text: next, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }
      return asset(`vo:${k}`, { VOICE, body }, (f) => post(`/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, body, f))
    }))
  }
}

const SFX = {
  click: { text: 'A single soft, crisp user-interface click, like tapping a glass trackpad. Clean, subtle, no reverb.', duration_seconds: 0.5 },
  key: { text: 'One soft laptop keyboard key press, gentle and quiet, close-miked, no room sound.', duration_seconds: 0.5 },
  remote: { text: 'A single soft TV remote button press, a gentle plastic click, quiet and clean.', duration_seconds: 0.5 },
  whoosh: { text: 'A soft, airy, modern transition whoosh, gentle and smooth, short tail, for a product video.', duration_seconds: 1.2 },
  chime: { text: 'A warm, gentle success chime, two soft bell tones rising, modern app notification, short and pleasant.', duration_seconds: 1.6 },
}
// Lines outside the film (voiced alone, so adding one never changes the film's own lines).
const EXTRA = {
  'episode-outro': 'Finesse is free, and it runs on your own computer. Get it on GitHub.',
}
if (what === 'voices' || what === 'all') {
  for (const [k, text] of Object.entries(EXTRA)) {
    const body = { text, model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }
    await asset(`vo:${k}`, { VOICE, body }, (f) => post(`/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, body, f))
  }
}

if (what === 'sfx' || what === 'all') {
  for (const [k, body] of Object.entries(SFX)) {
    const b = { ...body, prompt_influence: 0.5 }
    await asset(`sfx:${k}`, b, (f) => post('/v1/sound-generation?output_format=mp3_44100_128', b, f))
  }
}

if (what === 'music' || what === 'all') {
  const body = {
    prompt:
      'Warm, modern, understated instrumental background music for a friendly product walkthrough video. Soft felt piano, gentle warm synth pads, light airy percussion and a subtle pulsing bass, hopeful and calm, 92 BPM, steady and even with no big drops or crescendos, loopable. No vocals.',
    music_length_ms: 150000,
  }
  await asset('music:bed', body, (f) => post('/v1/music?output_format=mp3_44100_128', body, f))
}
console.log(Object.keys(index).length, 'assets in', indexFile)
