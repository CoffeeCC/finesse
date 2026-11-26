import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyLanguage, applyPicture, isLanguageRule, readLanguage, readPicture, type CustomFormat, type Profile, type QualityItem } from '../src/qualityRules.ts'
import { LANGUAGE_BLOCK, LANGUAGE_ONLY_MINE, LANGUAGE_PREFER } from '../src/stack/wire.ts'

// Radarr 6's own list (worst first), as an "HD-1080p" profile has it: [id, name, resolution] or a group.
type Row = [number, string, number] | [number, string, [number, string, number][]]
const RADARR: Row[] = [
  [0, 'Unknown', 0], [24, 'WORKPRINT', 0], [25, 'CAM', 0], [26, 'TELESYNC', 0], [27, 'TELECINE', 0], [29, 'REGIONAL', 480], [28, 'DVDSCR', 480],
  [1, 'SDTV', 480], [2, 'DVD', 0], [23, 'DVD-R', 480], [1000, 'WEB 480p', [[8, 'WEBDL-480p', 480], [12, 'WEBRip-480p', 480]]], [20, 'Bluray-480p', 480],
  [21, 'Bluray-576p', 576], [4, 'HDTV-720p', 720], [1001, 'WEB 720p', [[5, 'WEBDL-720p', 720], [14, 'WEBRip-720p', 720]]], [6, 'Bluray-720p', 720],
  [9, 'HDTV-1080p', 1080], [1002, 'WEB 1080p', [[3, 'WEBDL-1080p', 1080], [15, 'WEBRip-1080p', 1080]]], [7, 'Bluray-1080p', 1080], [30, 'Remux-1080p', 1080],
  [16, 'HDTV-2160p', 2160], [1003, 'WEB 2160p', [[18, 'WEBDL-2160p', 2160], [17, 'WEBRip-2160p', 2160]]], [19, 'Bluray-2160p', 2160], [31, 'Remux-2160p', 2160],
  [22, 'BR-DISK', 1080], [10, 'Raw-HD', 1080],
]
function profile(allowed: string[], extra: Partial<Profile> = {}): Profile {
  const items: QualityItem[] = RADARR.map(([id, name, r]) =>
    Array.isArray(r)
      ? { id, name, allowed: allowed.includes(name), items: r.map(([qid, qn, res]) => ({ quality: { id: qid, name: qn, resolution: res }, items: [], allowed: allowed.includes(name) })) }
      : { quality: { id, name, resolution: r }, items: [], allowed: allowed.includes(name) },
  )
  return { id: 4, name: 'HD-1080p', cutoff: 7, upgradeAllowed: true, items, minFormatScore: 0, formatItems: [], language: { id: 1, name: 'English' }, ...extra }
}
const allowedNames = (p: Profile) => p.items.filter((i) => i.allowed).map((i) => i.quality?.name ?? i.name)

test('picture: reads the sharpest allowed quality', () => {
  assert.equal(readPicture(profile(['HDTV-1080p', 'WEB 1080p', 'Bluray-1080p'])), 1080)
  assert.equal(readPicture(profile(['WEB 720p'])), 720)
  assert.equal(readPicture(profile(['SDTV', 'Bluray-576p'])), 480)
  assert.equal(readPicture(profile(['Bluray-1080p', 'Remux-2160p'])), 2160)
  assert.equal(readPicture(profile(['CAM'])), null)
})

test('picture: 1080p allows 720p and up to 1080p, keeps camcorder copies and new disc copies off', () => {
  const p = applyPicture(profile(['Bluray-2160p', 'CAM']), 1080)
  assert.deepEqual(allowedNames(p), ['HDTV-720p', 'WEB 720p', 'Bluray-720p', 'HDTV-1080p', 'WEB 1080p', 'Bluray-1080p'])
  assert.equal(p.cutoff, 7, 'upgrades until Bluray-1080p')
  // A group's own qualities follow the group.
  assert.ok(p.items.find((i) => i.name === 'WEB 720p')!.items.every((x) => x.allowed))
})

test('picture: disc copies someone allowed stay on up to the new limit, never as the cutoff', () => {
  const p = applyPicture(profile(['Bluray-1080p', 'Remux-1080p', 'Remux-2160p']), 1080)
  assert.ok(allowedNames(p).includes('Remux-1080p'))
  assert.ok(!allowedNames(p).includes('Remux-2160p'))
  assert.equal(p.cutoff, 7)
  const four = applyPicture(profile(['Bluray-1080p']), 2160)
  assert.equal(four.cutoff, 19, 'Bluray-2160p')
  assert.equal(four.items.find((i) => i.quality?.name === 'Remux-2160p')!.allowed, false)
})

test('picture: a group can be the cutoff; SD stays SD', () => {
  const sd = applyPicture(profile([]), 480)
  assert.deepEqual(allowedNames(sd), ['SDTV', 'DVD-R', 'WEB 480p', 'Bluray-480p', 'Bluray-576p'])
  assert.equal(sd.cutoff, 21)
  const odd: Profile = { ...profile([]), items: profile([]).items.filter((i) => i.name !== 'Bluray-720p' && i.quality?.name !== 'Bluray-720p') }
  assert.equal(applyPicture(odd, 720).cutoff, 1001, 'the WEB 720p group')
})

// The rules from a real household's Radarr (a guide's, not Finesse's).
const THEIRS: CustomFormat[] = [
  { id: 1, name: 'Foreign Language Block', specifications: [{ implementation: 'ReleaseTitleSpecification', fields: [{ name: 'value', value: '\\b(GERMAN|FRENCH|SPANISH|ITALIAN|RUSSIAN)\\b' }] }] },
  { id: 2, name: 'English Audio Preferred', specifications: [{ implementation: 'ReleaseTitleSpecification', fields: [{ name: 'value', value: '\\b(English[-._ ]?Dub|EngDub|Dual[-._ ]?Audio)' }] }] },
  { id: 3, name: 'Block: Non-English Release', specifications: [{ implementation: 'ReleaseTitleSpecification', fields: [{ name: 'value', value: '(?i)\\b(FRENCH|GERMAN|JAPANESE|KOREAN)\\b' }] }] },
  { id: 4, name: 'Language: English', specifications: [{ implementation: 'LanguageSpecification', fields: [{ name: 'value', value: 1 }] }] },
  { id: 5, name: 'x265', specifications: [{ implementation: 'ReleaseTitleSpecification', fields: [{ name: 'value', value: 'x265|HEVC' }] }] },
]
const OURS: CustomFormat[] = [
  { id: 10, name: LANGUAGE_PREFER, specifications: [{ implementation: 'LanguageSpecification', fields: [{ name: 'value', value: -2 }] }] },
  { id: 11, name: LANGUAGE_BLOCK, specifications: [{ implementation: 'LanguageSpecification', fields: [{ name: 'value', value: -2 }] }] },
  { id: 12, name: LANGUAGE_ONLY_MINE, specifications: [{ implementation: 'LanguageSpecification', fields: [{ name: 'value', value: 1 }] }] },
]
const IDS = { prefer: 10, block: 11, onlyMine: 12 }
const theirScores = [
  { format: 1, score: -10000 },
  { format: 2, score: 1000 },
  { format: 3, score: -10000 },
  { format: 4, score: 100 },
  { format: 5, score: -50 },
]
const score = (p: Profile, id: number) => p.formatItems.find((i) => i.format === id)?.score

test('language rules: language checks and release names with language words, nothing else', () => {
  assert.deepEqual(THEIRS.filter(isLanguageRule).map((c) => c.id), [1, 2, 3, 4])
})

test('language: someone’s own blocks read as their own rules, named', () => {
  const r = readLanguage(profile([], { formatItems: theirScores }), THEIRS, 'radarr')
  assert.equal(r.mode, 'custom')
  assert.deepEqual(r.otherRules, ['Foreign Language Block', 'Block: Non-English Release', 'English only (the profile’s language)'])
  // Sonarr has no profile language.
  assert.deepEqual(readLanguage(profile([], { formatItems: theirScores, language: undefined }), THEIRS, 'sonarr').otherRules, ['Foreign Language Block', 'Block: Non-English Release'])
})

test('language: “original or mine” turns their blocks off in this profile, keeps their preferences', () => {
  const p = applyLanguage(profile([], { formatItems: theirScores }), [...THEIRS, ...OURS], 'radarr', 'original', IDS)
  assert.equal(score(p, 1), 0)
  assert.equal(score(p, 3), 0)
  assert.equal(score(p, 2), 1000)
  assert.equal(score(p, 4), 100)
  assert.equal(score(p, 5), -50, 'not a language rule: untouched')
  assert.equal(score(p, 10), 10)
  assert.equal(score(p, 11), -10000)
  assert.equal(score(p, 12), 0)
  assert.deepEqual(p.language, { id: -1, name: 'Any' })
  assert.equal(readLanguage(p, [...THEIRS, ...OURS], 'radarr').mode, 'original')
})

test('language: “mine” and “any” round-trip', () => {
  const start = profile([], { formatItems: [], language: { id: -1, name: 'Any' } })
  const mine = applyLanguage(start, OURS, 'radarr', 'mine', IDS)
  assert.equal(score(mine, 12), -10000)
  assert.equal(score(mine, 11), 0)
  assert.equal(readLanguage(mine, OURS, 'radarr').mode, 'mine')
  const any = applyLanguage(mine, OURS, 'radarr', 'any', IDS)
  assert.equal(score(any, 12), 0)
  assert.equal(readLanguage(any, OURS, 'radarr').mode, 'any')
})

test('language: a minimum score only language rules reach is lifted unless the choice is “mine”', () => {
  const dub = profile([], { name: 'Anime English Dub', minFormatScore: 1000, formatItems: [{ format: 2, score: 1000 }], language: undefined })
  assert.deepEqual(readLanguage(dub, THEIRS, 'sonarr'), { mode: 'custom', otherRules: ['English Audio Preferred'] })
  assert.equal(applyLanguage(dub, [...THEIRS, ...OURS], 'sonarr', 'any', IDS).minFormatScore, 0)
  assert.equal(applyLanguage(dub, [...THEIRS, ...OURS], 'sonarr', 'mine', IDS).minFormatScore, 1000)
})

test('language: without a household language, only the preference is set', () => {
  const p = applyLanguage(profile([], { language: undefined }), [OURS[0]!], 'sonarr', 'original', { prefer: 10 })
  assert.deepEqual(p.formatItems, [{ format: 10, score: 10 }])
})
