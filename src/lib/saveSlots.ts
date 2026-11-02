// One place per person for a game's save in a browser that several profiles share.
//
// EmulatorJS (4.2.3) keeps a game's battery save at one path in the browser,
// /data/saves/<ROM file name>.srm, whoever is signed in: EJS_gameName doesn't change it. So
// on a shared browser, a second profile would play (and upload) the first one's save. Before
// the game reads it, the file at that path becomes the signed-in person's: whoever's copy was
// there moves to their own folder next to it (/data/saves/.finesse/<user>/), and this
// person's comes back from theirs. Nothing is deleted. Who holds the path is remembered in
// localStorage.
//
// A save from before Finesse kept saves per person has no holder. The first person to open
// the game here claims it: it's most likely theirs, and refusing would strand every existing
// player's progress. It can still only go up into an EMPTY slot of theirs (planSync uploads
// it with If-None-Match: *); if they already have a save on the server, they're asked which
// to keep. Pure (no EmulatorJS, no React), so server/test/save-slots.test.ts can check it.

export interface SlotFS {
  analyzePath(p: string): { exists: boolean }
  readFile(p: string): Uint8Array
  writeFile(p: string, d: Uint8Array): void
  mkdir(p: string): void
  unlink(p: string): void
}

export interface SlotStore {
  get(k: string): string | null
  set(k: string, v: string): void
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'someone'
const holderKey = (path: string) => `finesse.save.holder.${path}`

/** Where `who` keeps their copy while someone else's is in place (`kind`: '' their copy, '.kept' one set aside). */
export function stashPath(path: string, who: string, kind = ''): string {
  const i = path.lastIndexOf('/')
  return `${path.slice(0, i)}/.finesse/${safe(who)}/${path.slice(i + 1)}${kind}`
}

const exists = (fs: SlotFS, p: string) => {
  try {
    return fs.analyzePath(p).exists
  } catch {
    return false
  }
}

export function readSave(fs: SlotFS, p: string): Uint8Array | null {
  if (!exists(fs, p)) return null
  const d = fs.readFile(p)
  return d.length ? d : null
}

/** Write `d` at `p`, making its folders. */
export function writeSave(fs: SlotFS, p: string, d: Uint8Array): void {
  let dir = ''
  for (const part of p.split('/').filter(Boolean).slice(0, -1)) {
    dir += `/${part}`
    if (!exists(fs, dir)) fs.mkdir(dir)
  }
  if (exists(fs, p)) fs.unlink(p)
  fs.writeFile(p, d)
}

function move(fs: SlotFS, from: string, to: string) {
  writeSave(fs, to, fs.readFile(from))
  fs.unlink(from)
}

/**
 * Make the save at `path` this person's (see above). `claimed`: the copy now there is from
 * before Finesse kept saves per person, and this person just claimed it.
 */
export function takeSlot(fs: SlotFS, store: SlotStore, path: string, me: string): { claimed: boolean } {
  const holder = store.get(holderKey(path))
  let claimed = false
  if (holder !== me) {
    if (holder && exists(fs, path)) move(fs, path, stashPath(path, holder))
    else if (!holder && exists(fs, path)) claimed = true
    const mine = stashPath(path, me)
    if (!claimed && exists(fs, mine)) move(fs, mine, path)
    store.set(holderKey(path), me)
  }
  return { claimed }
}

/** Keep a copy that's being replaced (one per person and game), so a wrong choice can be undone by hand. */
export function setAside(fs: SlotFS, path: string, me: string, d: Uint8Array | null): void {
  if (d?.length) writeSave(fs, stashPath(path, me, '.kept'), d)
}
