// The friend's server for the Groups scene (see friend.sh).
//   node friend.mjs jellyfin   set up Maya's Jellyfin, write the key for her Finesse, wait for the posters
//   node friend.mjs pair       pair the demo and Maya's place both ways (skips what's already paired)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { wireJellyfin } from '../../../server/src/stack/wire.ts'

const FR = `${process.env.TOUR_DEMO}/friend`
const ENV = `${FR}/finesse.env`
const DEMO = 'http://localhost:8080'
const FRIEND = 'http://localhost:8093'
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="tour", Device="tour", DeviceId="tour-friend-setup", Version="1"${t ? `, Token="${t}"` : ''}` })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function signIn(base, user, pw) {
  const r = await fetch(`${base}/jellyfin/Users/AuthenticateByName`, { method: 'POST', headers: H(), body: JSON.stringify({ Username: user, Pw: pw }) })
  if (!r.ok) throw new Error(`${user} couldn’t sign in at ${base}: ${r.status}`)
  return (await r.json()).AccessToken
}
const api = async (base, token, method, path, body) => {
  const r = await fetch(`${base}/finesse${path}`, { method, headers: H(token), body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${data.error ?? ''}`)
  return data
}

if (process.argv[2] === 'jellyfin') {
  const known = existsSync(ENV) ? /JELLYFIN_API_KEY=(.+)/.exec(readFileSync(ENV, 'utf8'))?.[1] : undefined
  const r = await wireJellyfin(
    {
      url: 'http://localhost:8098',
      admin: { username: 'maya', password: 'FinesseFriend2026' },
      serverName: 'Maya’s place',
      language: 'en',
      country: 'GB',
      libraries: { movies: true, shows: false, music: false },
      apiKey: known,
      restart: async () => void execFileSync('docker', ['restart', 'tour-friend-jf']),
    },
    (m) => console.log(`  ${m}`),
  )
  writeFileSync(ENV, `JELLYFIN_API_KEY=${r.apiKey}\nJELLYFIN_BASE_PATH=${r.basePath}\n`, { mode: 0o600 })
  // Scan, then wait until the films have their posters.
  const J = `http://localhost:8098${r.basePath}`
  const t = await (async () => {
    const x = await fetch(`${J}/Users/AuthenticateByName`, { method: 'POST', headers: H(), body: JSON.stringify({ Username: 'maya', Pw: 'FinesseFriend2026' }) })
    return x.json()
  })()
  await fetch(`${J}/Library/Refresh`, { method: 'POST', headers: H(t.AccessToken) })
  for (let i = 0; i < 60; i++) {
    const items = await (await fetch(`${J}/Users/${t.User.Id}/Items?Recursive=true&IncludeItemTypes=Movie&Fields=ProviderIds`, { headers: H(t.AccessToken) })).json()
    const withArt = items.Items.filter((x) => x.ImageTags?.Primary && x.ProviderIds?.Tmdb).length
    if (items.TotalRecordCount >= 10 && withArt >= 8) {
      console.log(`  ${items.TotalRecordCount} films, ${withArt} with their poster`)
      break
    }
    if (i === 59) console.log(`  only ${withArt} of ${items.TotalRecordCount} films found their details (no internet for Maya's Jellyfin?)`)
    await sleep(5000)
  }
}

if (process.argv[2] === 'pair') {
  const alex = await signIn(DEMO, 'alex', 'FinesseDemo2026')
  const maya = await signIn(FRIEND, 'maya', 'FinesseFriend2026')
  const demo = await api(DEMO, alex, 'GET', '/api/groups')
  const friend = await api(FRIEND, maya, 'GET', '/api/groups')
  const pick = (o, names) => o.libraries.filter((l) => names.includes(l.type)).map((l) => l.id)
  if (!demo.friends.some((f) => f.name === friend.name)) {
    const { code } = await api(FRIEND, maya, 'POST', '/api/groups/codes', { libraries: pick(friend, ['movies']) })
    await api(DEMO, alex, 'POST', '/api/groups/friends', { url: 'http://tour-friend:8080', code })
    console.log(`  the demo now watches ${friend.name}`)
  }
  if (!friend.friends.some((f) => f.name === demo.name)) {
    const { code } = await api(DEMO, alex, 'POST', '/api/groups/codes', { libraries: pick(demo, ['movies', 'tvshows']) })
    await api(FRIEND, maya, 'POST', '/api/groups/friends', { url: 'http://finesse:8080', code })
    console.log(`  ${friend.name} now watches ${demo.name}`)
  }
  // Maya's household has been watching: the demo's Groups settings show it.
  const f = (await api(FRIEND, maya, 'GET', '/api/groups/friends')).friends.find((x) => x.name === demo.name)
  if (f) await fetch(`${FRIEND}/finesse/api/groups/friends/${f.id}/jellyfin/Users/me/Views`, { headers: H(maya) })
  console.log('  paired')
}
