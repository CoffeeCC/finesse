// Settings → Downloads → Quality, made easy: each Radarr/Sonarr quality profile as two plain
// choices (how sharp the picture can be, which languages are fine) plus, per app, whether very
// big files may download. Finesse reads the profiles as they are, whoever made them (setup, the
// person, a guide they followed), and writes back only what a choice changes. Language choices
// use Finesse's own custom formats (stack/wire.ts); someone's own rules that block languages
// are listed by name, and turned off for a profile only when its choice says other languages
// are fine. Administrators only: these are the apps' own settings.

import type { Auth } from './auth.ts'
import type { Endpoint, SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { Arr, LANGUAGE_BLOCK, LANGUAGE_ONLY_MINE, LANGUAGE_PREFER, ensureLanguageFormats, languageName } from './stack/wire.ts'

export type QualityApp = 'radarr' | 'sonarr'
export const QUALITY_APPS: QualityApp[] = ['radarr', 'sonarr']
const NAME: Record<QualityApp, string> = { radarr: 'Radarr', sonarr: 'Sonarr' }

/** The best picture a profile goes up to: SD, 720p, 1080p or 4K. */
export type Picture = 480 | 720 | 1080 | 2160
export const PICTURES: Picture[] = [480, 720, 1080, 2160]
/** original: the title's own language or the household's. mine: the household's only. any: any language. */
export type LanguageMode = 'original' | 'mine' | 'any'
export const LANGUAGE_MODES: LanguageMode[] = ['original', 'mine', 'any']

export interface QualityItem {
  id?: number
  name?: string
  quality?: { id: number; name: string; resolution?: number }
  items: QualityItem[]
  allowed: boolean
  [k: string]: unknown
}
export interface Profile {
  id: number
  name: string
  cutoff: number
  upgradeAllowed?: boolean
  items: QualityItem[]
  minFormatScore?: number
  formatItems: { format: number; name?: string; score: number }[]
  language?: { id: number; name: string }
  [k: string]: unknown
}
export interface CustomFormat {
  id: number
  name: string
  specifications: { implementation: string; negate?: boolean; fields: { name: string; value: unknown }[] }[]
}
interface QualityDefinition {
  id: number
  quality: { id: number; name: string }
  maxSize?: number | null
  preferredSize?: number | null
  [k: string]: unknown
}

/** One profile, the way the page shows it. */
export interface SimpleProfile {
  id: number
  name: string
  /** Null when nothing in it is allowed (or only odd qualities): the app's own page is the place for it. */
  picture: Picture | null
  language: LanguageMode | 'custom'
  /** The person's own rules that hold other languages back in this profile (names, for the page to show). */
  otherRules: string[]
}
export interface AppQuality {
  app: QualityApp
  name: string
  /** The household's language as the apps name it; null when the apps don't know it ("mine" can't be offered). */
  household: string | null
  /** Whether very big files may download (no size caps), and whether Finesse can put the old caps back. */
  bigFiles: { allowed: boolean; canRestore: boolean }
  profiles: SimpleProfile[]
}

// ---------------------------------------------------------------------------
// Picture
// ---------------------------------------------------------------------------

/** Sources nobody wants from a quality setting (camcorder copies and the like). */
const POOR = /^(cam|telesync|telecine|workprint|dvdscr|regional)$/i
/** Untouched disc copies: very big, only kept on where someone already allowed them. */
const DISC = /remux|br-?disk|raw-?hd/i

const leaves = (it: QualityItem): QualityItem[] => (it.quality ? [it] : it.items.filter((x) => x.quality))
const resOf = (it: QualityItem) => Math.max(0, ...leaves(it).map((x) => x.quality?.resolution ?? 0))
const poor = (it: QualityItem) => leaves(it).length > 0 && leaves(it).every((x) => POOR.test(x.quality!.name))
const disc = (it: QualityItem) => leaves(it).some((x) => DISC.test(x.quality!.name))
const bucket = (res: number): Picture => (res <= 576 ? 480 : res <= 720 ? 720 : res <= 1080 ? 1080 : 2160)

export function readPicture(p: Profile): Picture | null {
  const res = p.items.filter((it) => it.allowed && !poor(it)).map(resOf).filter((r) => r > 0)
  return res.length ? bucket(Math.max(...res)) : null
}

/**
 * Allows everything from a sensible floor up to `max` (720p and up for 1080p and 4K, 480p and
 * up for 720p, SD for SD), so a title still downloads when only a smaller copy exists, and
 * upgrades until it reaches `max`. Camcorder copies stay off; disc copies stay as they were,
 * unless they're sharper than `max`. Items are listed worst first, so the cutoff is the last
 * allowed one that isn't a disc copy.
 */
export function applyPicture(p: Profile, max: Picture): Profile {
  const out = structuredClone(p)
  const floor = max >= 1080 ? 720 : max === 720 ? 480 : 1
  const top = max === 480 ? 576 : max
  for (const it of out.items) {
    const res = resOf(it)
    if (res === 0 && !poor(it)) continue // "Unknown" and the like: left as they are
    const want = poor(it) ? false : disc(it) ? it.allowed && res <= top : res >= floor && res <= top
    it.allowed = want
    for (const x of it.items) x.allowed = want
  }
  const best = [...out.items].reverse().find((it) => it.allowed && !disc(it) && resOf(it) > 0)
  if (!best) throw new ApiError(400, `“${p.name}” has no ${max === 2160 ? '4K' : max === 480 ? 'SD' : `${max}p`} qualities to allow. Pick another option, or change it in the app itself.`)
  out.cutoff = best.quality ? best.quality.id : (best.id as number)
  out.upgradeAllowed = true
  return out
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

const OURS = new Set([LANGUAGE_BLOCK, LANGUAGE_PREFER, LANGUAGE_ONLY_MINE])
const LANG_WORDS = ['english', 'french', 'german', 'spanish', 'italian', 'japanese', 'korean', 'russian', 'hindi', 'portuguese', 'polish', 'dutch', 'swedish', 'nordic', 'turkish', 'chinese', 'latino', 'vostfr', 'castellano', 'dub']

/** A rule about languages: the apps' language check, or a release-name match on language words. */
export function isLanguageRule(cf: CustomFormat): boolean {
  return cf.specifications.some((s) => {
    if (s.implementation === 'LanguageSpecification') return true
    if (s.implementation !== 'ReleaseTitleSpecification') return false
    const v = String(s.fields.find((f) => f.name === 'value')?.value ?? '').toLowerCase()
    return LANG_WORDS.filter((w) => v.includes(w)).length >= 2
  })
}

const BLOCKS = -1000
const scoreOf = (p: Profile, id: number | undefined) => (id === undefined ? 0 : (p.formatItems.find((i) => i.format === id)?.score ?? 0))

/** Someone's own language rules that keep other languages out of this profile. */
function othersIn(p: Profile, cfs: CustomFormat[]) {
  const mine = cfs.filter((cf) => !OURS.has(cf.name) && isLanguageRule(cf))
  const blocking = mine.filter((cf) => scoreOf(p, cf.id) <= BLOCKS)
  // A minimum score only language rules can reach: nothing passes without them.
  const required = (p.minFormatScore ?? 0) > 0 ? mine.filter((cf) => scoreOf(p, cf.id) > 0) : []
  return { blocking, required }
}

/** What a profile does now: one of the choices, or "custom" when someone's own rules decide (named in otherRules). */
export function readLanguage(p: Profile, cfs: CustomFormat[], app: QualityApp): { mode: LanguageMode | 'custom'; otherRules: string[] } {
  const id = (name: string) => cfs.find((c) => c.name === name)?.id
  const { blocking, required } = othersIn(p, cfs)
  const otherRules = [...blocking, ...required].map((c) => c.name)
  if (app === 'radarr' && p.language && p.language.id > 0) otherRules.push(`${p.language.name} only (the profile’s language)`)
  if (scoreOf(p, id(LANGUAGE_ONLY_MINE)) <= BLOCKS) return { mode: 'mine', otherRules }
  if (otherRules.length) return { mode: 'custom', otherRules }
  if (scoreOf(p, id(LANGUAGE_BLOCK)) <= BLOCKS) return { mode: 'original', otherRules }
  return { mode: 'any', otherRules }
}

/** `ids`: Finesse's formats in this app (block and onlyMine are missing when the household's language is unknown). */
export function applyLanguage(p: Profile, cfs: CustomFormat[], app: QualityApp, mode: LanguageMode, ids: { prefer: number; block?: number; onlyMine?: number }): Profile {
  const out = structuredClone(p)
  const set = (format: number | undefined, score: number) => {
    if (format === undefined) return
    const item = out.formatItems.find((i) => i.format === format)
    if (item) item.score = score
    else out.formatItems.push({ format, score })
  }
  set(ids.prefer, 10)
  set(ids.block, mode === 'original' ? -10000 : 0)
  set(ids.onlyMine, mode === 'mine' ? -10000 : 0)
  // Radarr's own language setting would overrule all of this: Finesse's formats decide instead.
  if (app === 'radarr' && out.language && out.language.id !== -1) out.language = { id: -1, name: 'Any' }
  if (mode !== 'mine') {
    const { blocking, required } = othersIn(p, cfs)
    for (const cf of blocking) set(cf.id, 0)
    if (required.length) out.minFormatScore = 0
  }
  return out
}

// ---------------------------------------------------------------------------
// The apps
// ---------------------------------------------------------------------------

type SizeCaps = Record<string, { max: number | null; preferred: number | null }>

function household(settings: SettingsStore): string {
  const doc = settings.get().setup.lastDoc as { server?: { language?: string } } | undefined
  return doc?.server?.language || 'en'
}

function arrFor(settings: SettingsStore, app: QualityApp): Arr {
  const svc: Endpoint | undefined = settings.get().services[app]
  if (!svc?.url) throw new ApiError(400, `${NAME[app]} isn’t set up on this server`)
  return new Arr(svc.url, svc.apiKey ?? '', 'v3')
}

async function reach<T>(app: QualityApp, f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(502, `Couldn’t reach ${NAME[app]}. Make sure it’s running (Settings → Health), then try again.`)
  }
}

export async function readApp(settings: SettingsStore, app: QualityApp, arr = arrFor(settings, app)): Promise<AppQuality> {
  return reach(app, async () => {
    const [profiles, cfs, defs, schema] = await Promise.all([
      arr.req<Profile[]>('GET', '/qualityprofile'),
      arr.req<CustomFormat[]>('GET', '/customformat'),
      arr.req<QualityDefinition[]>('GET', '/qualitydefinition'),
      arr.req<{ implementation: string; fields: { name: string; selectOptions?: { name: string }[] }[] }[]>('GET', '/customformat/schema'),
    ])
    const options = schema.find((s) => s.implementation === 'LanguageSpecification')?.fields.find((f) => f.name === 'value')?.selectOptions ?? []
    const name = languageName(household(settings))
    return {
      app,
      name: NAME[app],
      household: name && options.some((o) => o.name.toLowerCase() === name.toLowerCase()) ? name : null,
      bigFiles: { allowed: defs.every((d) => !d.maxSize), canRestore: Boolean(settings.get().quality?.sizeCaps?.[app]) },
      profiles: profiles.map((p) => {
        const l = readLanguage(p, cfs, app)
        return { id: p.id, name: p.name, picture: readPicture(p), language: l.mode, otherRules: l.otherRules }
      }),
    }
  })
}

export async function changeProfile(settings: SettingsStore, app: QualityApp, id: number, choice: { picture?: Picture; language?: LanguageMode }, arr = arrFor(settings, app)) {
  await reach(app, async () => {
    const profiles = await arr.req<Profile[]>('GET', '/qualityprofile')
    let p = profiles.find((x) => x.id === id)
    if (!p) throw new ApiError(404, `${NAME[app]} doesn’t have that profile any more. Reload the page.`)
    if (choice.picture !== undefined) p = applyPicture(p, choice.picture)
    if (choice.language !== undefined) {
      const f = await ensureLanguageFormats(arr, app, household(settings), { onlyMine: true })
      if (choice.language === 'mine' && f.ids.onlyMine === undefined) throw new ApiError(400, `${NAME[app]} doesn’t know this server’s language, so it can’t keep to it. Pick another option.`)
      const cfs = await arr.req<CustomFormat[]>('GET', '/customformat')
      // The app adds a new format to every profile: read the profile again so its list is current.
      const fresh = (await arr.req<Profile[]>('GET', '/qualityprofile')).find((x) => x.id === id)!
      p = applyLanguage({ ...p, formatItems: mergeItems(p.formatItems, fresh.formatItems) }, cfs, app, choice.language, f.ids)
    }
    await arr.req('PUT', `/qualityprofile/${id}`, p)
  })
}

/** The profile's format list with any formats the app added since it was read. */
const mergeItems = (had: Profile['formatItems'], now: Profile['formatItems']) => [...had, ...now.filter((n) => !had.some((h) => h.format === n.format))]

/**
 * Big files on: the app's size caps are saved in Finesse, then lifted (an open cap needs no
 * preferred size either, or the apps keep the old cap). Off: the saved caps go back.
 */
export async function setBigFiles(settings: SettingsStore, app: QualityApp, allowed: boolean, arr = arrFor(settings, app)) {
  await reach(app, async () => {
    const defs = await arr.req<QualityDefinition[]>('GET', '/qualitydefinition')
    if (allowed) {
      const caps: SizeCaps = {}
      for (const d of defs) if (d.maxSize || d.preferredSize) caps[String(d.id)] = { max: d.maxSize ?? null, preferred: d.preferredSize ?? null }
      if (!Object.keys(caps).length) return
      // Keep caps saved earlier for definitions that are already open.
      const before = settings.get().quality?.sizeCaps?.[app] ?? {}
      settings.update((s) => {
        s.quality = { ...s.quality, sizeCaps: { ...s.quality?.sizeCaps, [app]: { ...before, ...caps } } }
      })
      // One at a time: the apps' bulk update quietly keeps a cap it's asked to drop.
      for (const d of defs) if (d.maxSize || d.preferredSize) await arr.req('PUT', `/qualitydefinition/${d.id}`, { ...d, maxSize: null, preferredSize: null })
      return
    }
    const caps = settings.get().quality?.sizeCaps?.[app]
    if (!caps) throw new ApiError(400, `Finesse doesn’t know ${NAME[app]}’s old size limits. Set them in ${NAME[app]} → Settings → Quality.`)
    for (const d of defs) {
      const c = caps[String(d.id)]
      if (c) await arr.req('PUT', `/qualitydefinition/${d.id}`, { ...d, maxSize: c.max, preferredSize: c.preferred })
    }
    settings.update((s) => {
      if (s.quality?.sizeCaps) delete s.quality.sizeCaps[app]
    })
  })
}

export function registerQualityRules(router: Router, deps: { settings: SettingsStore; auth: Auth; arr?: (app: QualityApp) => Arr }) {
  const { settings, auth } = deps
  const appOf = (v: string | undefined): QualityApp => {
    if (!QUALITY_APPS.includes(v as QualityApp) || !settings.get().services[v as QualityApp]?.url) throw new ApiError(404, 'That app isn’t set up on this server')
    return v as QualityApp
  }
  const arr = (app: QualityApp) => deps.arr?.(app) ?? arrFor(settings, app)
  const one = async (app: QualityApp) => {
    try {
      return await readApp(settings, app, arr(app))
    } catch (e) {
      return { app, name: NAME[app], error: e instanceof ApiError ? e.message : `Couldn’t read ${NAME[app]}’s quality settings` }
    }
  }

  router.get('/api/quality', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const apps = QUALITY_APPS.filter((a) => settings.get().services[a]?.url)
    sendJson(res, 200, { apps: await Promise.all(apps.map(one)) })
  })
  // { picture?: 480 | 720 | 1080 | 2160, language?: 'original' | 'mine' | 'any' }
  router.put('/api/quality/:app/profiles/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const app = appOf(params.app)
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Which profile?')
    const body = await readJson<{ picture?: unknown; language?: unknown }>(req)
    const choice: { picture?: Picture; language?: LanguageMode } = {}
    if (body.picture !== undefined) {
      if (!PICTURES.includes(body.picture as Picture)) throw new ApiError(400, 'Pick SD, 720p, 1080p or 4K')
      choice.picture = body.picture as Picture
    }
    if (body.language !== undefined) {
      if (!LANGUAGE_MODES.includes(body.language as LanguageMode)) throw new ApiError(400, 'Pick which languages are fine')
      choice.language = body.language as LanguageMode
    }
    if (choice.picture === undefined && choice.language === undefined) throw new ApiError(400, 'Nothing to change')
    await changeProfile(settings, app, id, choice, arr(app))
    sendJson(res, 200, await readApp(settings, app, arr(app)))
  })
  // { allowed: boolean }
  router.put('/api/quality/:app/big-files', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const app = appOf(params.app)
    const body = await readJson<{ allowed?: unknown }>(req)
    if (typeof body.allowed !== 'boolean') throw new ApiError(400, 'Allow big files: yes or no?')
    await setBigFiles(settings, app, body.allowed, arr(app))
    sendJson(res, 200, await readApp(settings, app, arr(app)))
  })
}
