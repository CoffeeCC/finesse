// Finding a title from what someone typed, typos and all: "harbur lihgts" is Harbour Lights.
// Jellyfin's own search only matches exact pieces of words, and takes a round trip; this runs on
// the list of titles the app already holds, on every keystroke.
// Pure (no imports), so server/test/fuzzy.test.ts can test it.

/** Lower case, no accents or punctuation, "&" as "and", no leading "the". */
export function plain(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '')
}

/** How many single-letter slips (a wrong, missing, extra or swapped letter) turn `a` into `b`,
 *  giving up past `max` (returns max + 1). */
export function slips(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1)
      cur[j] = v
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]!
}

/** Slips forgiven in a word of this length: none in very short ones, one, then two. */
const allowed = (len: number) => (len <= 3 ? 0 : len <= 7 ? 1 : 2)

/**
 * How well `title` answers `query`: 0 = it doesn't; 100 = the very title. Exact pieces of the
 * title beat typo matches, and every word typed has to be found somewhere in the title (the last
 * one may be unfinished: people search as they type).
 */
export function fuzzyScore(title: string, query: string): number {
  const t = plain(title)
  const q = plain(query)
  if (!t || !q) return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 90
  if (` ${t}`.includes(` ${q}`)) return 80
  if (t.includes(q)) return 70
  const words = t.split(' ')
  const typed = q.split(' ')
  let total = 0
  for (let k = 0; k < typed.length; k++) {
    const w = typed[k]!
    const last = k === typed.length - 1
    const max = allowed(w.length)
    let best = max + 1
    for (const x of words) {
      if (x === w || (last && x.startsWith(w))) {
        best = 0
        break
      }
      // An unfinished last word is compared with the same-length start of the title's word.
      const d = Math.min(slips(w, x, max), last && x.length > w.length ? slips(w, x.slice(0, w.length), max) : max + 1)
      if (d < best) best = d
    }
    if (best > max) return 0
    total += best
  }
  return Math.max(20, 60 - total * 10)
}

/** The best `limit` of `items` for `query`, best first (ties keep their order). */
export function fuzzyFind<T>(items: T[], query: string, name: (t: T) => string, limit = 12): T[] {
  if (plain(query).length < 2) return []
  return items
    .map((item, i) => ({ item, s: fuzzyScore(name(item), query), i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item)
}
