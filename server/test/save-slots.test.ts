// Profiles sharing one browser (src/lib/saveSlots.ts): EmulatorJS keeps a game's save at one
// path whoever is signed in, so each person's copy is swapped in and out of it.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSave, setAside, stashPath, takeSlot, writeSave, type SlotFS, type SlotStore } from '../../src/lib/saveSlots.ts'
import { planSync, saveFingerprint } from '../../src/lib/saveSync.ts'

// EmulatorJS's FS, as far as we use it.
function memFS(): SlotFS & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  const dirs = new Set<string>(['/', '/data', '/data/saves'])
  return {
    files,
    analyzePath: (p) => ({ exists: files.has(p) || dirs.has(p) }),
    readFile: (p) => {
      const f = files.get(p)
      if (!f) throw new Error(`ENOENT ${p}`)
      return f.slice()
    },
    writeFile: (p, d) => void files.set(p, d.slice()),
    mkdir: (p) => {
      if (dirs.has(p)) throw new Error('EEXIST')
      dirs.add(p)
    },
    unlink: (p) => void files.delete(p),
  }
}
const memStore = (): SlotStore => {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }
}

const PATH = '/data/saves/Pokemon Emerald.srm'
const save = (v: number) => new Uint8Array(1024).fill(v)
const fp = (b: Uint8Array | null) => (b ? saveFingerprint(b) : null)

test('a second profile on the same browser never gets (or uploads) the first one’s save', () => {
  const fs = memFS()
  const store = memStore()
  // Alex plays: Alex holds the path.
  takeSlot(fs, store, PATH, 'alex')
  writeSave(fs, PATH, save(1))
  // Robin opens the same game here; Robin's server slot is empty.
  const { claimed } = takeSlot(fs, store, PATH, 'robin')
  assert.equal(claimed, false)
  const local = readSave(fs, PATH)
  assert.equal(local, null, 'Robin starts with no save, not Alex’s')
  assert.equal(planSync(fp(local), null, null), 'none', 'so nothing is uploaded into Robin’s slot')
  // Robin saves; Alex comes back to their own save, and Robin's waits for Robin.
  writeSave(fs, PATH, save(2))
  takeSlot(fs, store, PATH, 'alex')
  assert.deepEqual(readSave(fs, PATH), save(1))
  takeSlot(fs, store, PATH, 'robin')
  assert.deepEqual(readSave(fs, PATH), save(2))
})

test('the same person again: nothing moves', () => {
  const fs = memFS()
  const store = memStore()
  takeSlot(fs, store, PATH, 'alex')
  writeSave(fs, PATH, save(1))
  assert.deepEqual(takeSlot(fs, store, PATH, 'alex'), { claimed: false })
  assert.deepEqual(readSave(fs, PATH), save(1))
})

test('a save from before Finesse kept saves per person: the first to open it claims it, into an empty slot only', () => {
  const fs = memFS()
  const store = memStore()
  writeSave(fs, PATH, save(7)) // written by an older Finesse, holder unknown
  const { claimed } = takeSlot(fs, store, PATH, 'alex')
  assert.equal(claimed, true)
  const local = fp(readSave(fs, PATH))
  // Alex's server slot is empty: it goes up (with If-None-Match: *, so only if still empty).
  assert.equal(planSync(local, null, null), 'upload')
  // Alex already has a different save on the server: asked, not overwritten.
  assert.equal(planSync(local, fp(save(8)), null), 'conflict')
  // Then Robin opens it: Alex's now, so Robin gets nothing of it.
  assert.deepEqual(takeSlot(fs, store, PATH, 'robin'), { claimed: false })
  assert.equal(readSave(fs, PATH), null)
})

test('a copy being replaced is set aside, per person', () => {
  const fs = memFS()
  setAside(fs, PATH, 'alex', save(3))
  assert.deepEqual(fs.readFile(stashPath(PATH, 'alex', '.kept')), save(3))
  assert.equal(stashPath(PATH, '../x', '.kept'), '/data/saves/.finesse/x/Pokemon Emerald.srm.kept')
})
