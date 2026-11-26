// Why a request hasn't downloaded: Radarr/Sonarr's reasons for turning down each copy they
// found, in plain words, and what one setting would change most. Built from an interactive
// search (src/api/arr.ts arrSearchReleases), so it's what the search sites have right now.
// Pure (no imports), so server/test/why-nothing.test.ts can test it.

export type Reason = 'language' | 'size' | 'quality' | 'rule' | 'seeders' | 'other-title' | 'have' | 'blocklist' | 'other'

export interface CopyFacts {
  title: string
  size: number
  seeders?: number
  /** Languages the app read from the copy's name. */
  languages?: string[]
  rejections: string[]
}

export interface Explained {
  reason: Reason
  /** One short line: "In Japanese, and your settings want English". */
  text: string
}

export interface WhyNothing {
  /** Copies of this title (not counting ones that turned out to be something else). */
  found: number
  /** Copies the app would take as they are (a search would grab one soon). */
  fine: number
  /** "Found 12 copies, but none fit your settings." */
  headline: string
  /** One line per kind of problem, most common first. */
  lines: string[]
  /** The setting that would let most of them through, for administrators. */
  fix?: 'language' | 'size' | 'quality'
}

const LANGUAGE_WORDS = /language|english|foreign|dub|french|german|spanish|japanese|korean|italian|russian|hindi|chinese|portuguese/i

/** One of the app's reasons, in plain words. */
export function explain(raw: string): Explained {
  const s = raw.trim()
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(.+?) is wanted, but found (.+)$/i))) return { reason: 'language', text: `In ${m[2]}, and your settings want ${m[1]}` }
  if ((m = s.match(/^Custom Formats? (.+?) ha(?:s|ve) score -?\d+ below .*minimum/i))) {
    const names = m[1]!
    return LANGUAGE_WORDS.test(names) ? { reason: 'language', text: `Blocked by your language rules (${names})` } : { reason: 'rule', text: `Blocked by your rules (${names})` }
  }
  if (/is larger than maximum allowed/i.test(s)) return { reason: 'size', text: `Bigger than your size limit${sizeOf(s)}` }
  if (/is smaller than minimum allowed/i.test(s)) return { reason: 'size', text: `Smaller than your size limit allows${sizeOf(s)}` }
  if ((m = s.match(/^(.+?) is not wanted in profile/i))) return { reason: 'quality', text: `${m[1]} isn’t a quality your settings allow` }
  if (/unknown (movie|series)|unable to (match|parse)|wrong (movie|series|season|episode)|not match/i.test(s)) return { reason: 'other-title', text: 'Looks like a different title' }
  if (/seeders/i.test(s)) return { reason: 'seeders', text: 'Nobody is sharing it right now' }
  if (/blocklist/i.test(s)) return { reason: 'blocklist', text: 'Blocked after an earlier download of it failed' }
  if (/existing file|meets (quality )?cutoff|not an upgrade|equal or higher/i.test(s)) return { reason: 'have', text: 'You already have it at this quality' }
  return { reason: 'other', text: s }
}

const sizeOf = (s: string) => {
  const m = s.match(/^([\d.]+ [KMGT]B) is (?:larger|smaller) than (?:maximum|minimum) allowed ([\d.]+ [KMGT]B)/i)
  return m ? ` (${m[1]}; the limit is ${m[2]})` : ''
}

const PLURAL = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What the search found, summed up. `wanted` is the household's language as the app names it, if known. */
export function whyNothing(copies: CopyFacts[], wanted?: string): WhyNothing {
  const explained = copies.map((c) => ({ c, why: c.rejections.map(explain) }))
  // Not told? The app's own reasons say it ("English is wanted, but found Japanese").
  wanted ??= copies.flatMap((c) => c.rejections).map((x) => x.match(/^(.+?) is wanted, but found/i)?.[1]).find(Boolean)
  const ours = explained.filter((x) => !x.why.some((w) => w.reason === 'other-title'))
  const fine = ours.filter((x) => x.why.length === 0).length
  const elsewhere = explained.length - ours.length
  if (ours.length === 0) {
    return {
      found: 0,
      fine: 0,
      headline: 'Your search sites don’t have it yet',
      lines: [`${elsewhere ? `${PLURAL(elsewhere, 'result was', 'results were')} something else with a similar name. ` : ''}It downloads by itself as soon as a copy turns up.`],
    }
  }
  if (fine > 0) {
    return { found: ours.length, fine, headline: `${PLURAL(fine, 'copy fits', 'copies fit')} your settings`, lines: ['It should start downloading soon. If it doesn’t, pick one below.'] }
  }
  const count = (r: Reason) => ours.filter((x) => x.why.some((w) => w.reason === r)).length
  const langs = [...new Set(ours.flatMap((x) => (x.why.some((w) => w.reason === 'language') ? (x.c.languages ?? []) : [])).filter((l) => l && l !== wanted && l !== 'Unknown'))]
  const lines: [number, string][] = []
  const add = (r: Reason, text: (n: number) => string) => {
    const n = count(r)
    if (n) lines.push([n, text(n)])
  }
  add('language', (n) => `${PLURAL(n, 'is', 'are')} in ${langs.length ? langs.slice(0, 3).join(', ') : 'another language'}${wanted ? `, and your settings want ${wanted}` : ', which your settings don’t allow'}`)
  add('size', (n) => `${PLURAL(n, 'is', 'are')} outside your size limits`)
  add('quality', (n) => `${PLURAL(n, 'is', 'are')} a quality your settings don’t allow`)
  add('rule', (n) => `${PLURAL(n, 'is', 'are')} blocked by your own rules`)
  add('seeders', (n) => `${PLURAL(n, 'has', 'have')} nobody sharing ${n === 1 ? 'it' : 'them'}`)
  add('blocklist', (n) => `${PLURAL(n, 'was', 'were')} blocked after a failed download`)
  add('other', (n) => `${PLURAL(n, 'was', 'were')} turned down for another reason`)
  lines.sort((a, b) => b[0] - a[0])
  // The fix that would let the most copies through on its own.
  const alone = (r: 'language' | 'size' | 'quality') => ours.filter((x) => x.why.length > 0 && x.why.every((w) => w.reason === r || w.reason === 'seeders')).length
  const best = (['language', 'size', 'quality'] as const).map((r) => [r, alone(r), count(r)] as const).sort((a, b) => b[1] - a[1] || b[2] - a[2])[0]!
  return {
    found: ours.length,
    fine: 0,
    headline: `Found ${PLURAL(ours.length, 'copy', 'copies')}, but none fit your settings`,
    lines: lines.map(([, t]) => t),
    ...(best[2] > 0 ? { fix: best[0] } : {}),
  }
}

/** Copies worth offering first: fewest problems that matter, then the most people sharing. */
export function rankCopies<T extends CopyFacts>(copies: T[]): T[] {
  const weight = (c: CopyFacts) =>
    c.rejections.map(explain).reduce((n, w) => n + (w.reason === 'other-title' ? 100 : w.reason === 'seeders' ? 5 : w.reason === 'blocklist' ? 20 : 1), 0)
  return [...copies].sort((a, b) => weight(a) - weight(b) || (b.seeders ?? Infinity) - (a.seeders ?? Infinity) || b.size - a.size)
}
