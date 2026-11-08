// Settings → Consoles and setup's consoles, against a scratch settings file:
// a setup re-run keeps what Settings changed, removing works with your own
// emulators folder, folders are made (and owned) only when Finesse made them.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SettingsStore } from '../src/config.ts'
import { applyConsoles, consoleNotes, consoleViews, folderLabel, hostPathOf, makeFolders, setupConsoles, withConsoles } from '../src/emuapi.ts'
import { COMMUNITY_BUILD, withoutFolder } from '../../src/lib/consoleText.ts'
import { EMULATOR_PINS } from '../src/emucatalog.ts'
import { EmulatorDownloads } from '../src/emudownload.ts'
import { appMounts, emulatorCatalog, esdeLinks, stageSaves, wolfApp, type EmulatorSettings } from '../src/emulators.ts'
import { tmp } from './helpers.ts'

export function store(dir = tmp('emuapi-')) {
  return new SettingsStore({ configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'i.db'), bakedWeb: dir, updatedWeb: dir, previews: dir, backups: dir })
}
const me = { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 }

/** What the wizard sends with Games on, and what setup does with it (the settings part of apply.ts). */
async function runSetup(settings: SettingsStore, downloads: EmulatorDownloads, doc: EmulatorSettings) {
  settings.update((x) => {
    x.setup.lastDoc = structuredClone({ version: 1, emulators: doc })
  })
  return setupConsoles(settings, null, downloads, doc, me)
}

test('a setup re-run changes nothing Settings → Consoles changed: removed consoles, own folders', async () => {
  const dir = tmp('emuapi-rerun-')
  const settings = store(join(dir, 'config'))
  settings.update((x) => {
    x.mode = 'bundle'
    x.stack = { hostData: join(dir, 'data') } as never
  })
  const downloads = new EmulatorDownloads(join(dir, 'config', 'emulators'))
  const all = ['pcsx2', 'dolphin', 'rpcs3', 'cemu', 'eden'] as const
  // First setup: every console ticked.
  await runSetup(settings, downloads, { apps: [], paths: {}, install: [...all] })
  assert.deepEqual(settings.get().emulators!.install, [...all])
  // Later, in Settings: Cemu goes, PCSX2 gets its own BIOS folder, ES-DE and one profile.
  await applyConsoles(settings, null, downloads, [], ['cemu'], me)
  settings.update((x) => {
    const e = x.emulators!
    e.folders = { pcsx2: { firmware: join(dir, 'my-bios') } }
    e.apps.push('esde')
    e.profiles = ['user']
  })
  const before = structuredClone(settings.get().emulators)
  // Re-running setup starts from the stored document, which follows Settings.
  const last = settings.get().setup.lastDoc as { emulators: EmulatorSettings }
  assert.deepEqual(last.emulators.install, ['pcsx2', 'dolphin', 'rpcs3', 'eden'])
  await runSetup(settings, downloads, structuredClone(last.emulators))
  assert.deepEqual(settings.get().emulators, before)
  // Even a stale document (Cemu still ticked) only adds Cemu back; nothing else changes.
  await runSetup(settings, downloads, { apps: [], paths: {}, install: [...all] })
  const after = settings.get().emulators!
  assert.deepEqual(after.folders, before!.folders)
  assert.deepEqual(after.profiles, ['user'])
  assert.ok(after.apps.includes('esde') && after.apps.includes('cemu'))
  assert.equal(after.switchEmulator, 'eden')
})

test('removing a console with your own emulators folder takes it out of the games list; your file stays', async () => {
  const dir = tmp('emuapi-own-')
  mkdirSync(join(dir, 'emu'), { recursive: true })
  writeFileSync(join(dir, 'emu', 'Dolphin-x86_64.AppImage'), '')
  const settings = store(join(dir, 'config'))
  settings.update((x) => {
    x.emulators = { apps: ['dolphin', 'pcsx2'], paths: { roms: join(dir, 'roms'), emulators: join(dir, 'emu'), saves: join(dir, 'saves') } }
  })
  const downloads = new EmulatorDownloads(join(dir, 'config', 'emulators'))
  await applyConsoles(settings, null, downloads, [], ['dolphin'], me)
  assert.deepEqual(settings.get().emulators!.apps, ['pcsx2'])
  assert.ok(existsSync(join(dir, 'emu', 'Dolphin-x86_64.AppImage')))
  assert.equal(consoleViews(settings.get(), downloads).find((c) => c.id === 'dolphin')!.added, false)
})

test('adding a console you already have in your own folder: its app, no download, "your own copy"', async () => {
  const dir = tmp('emuapi-ownadd-')
  mkdirSync(join(dir, 'emu'), { recursive: true })
  writeFileSync(join(dir, 'emu', 'pcsx2-v2.0.AppImage'), '')
  const settings = store(join(dir, 'config'))
  settings.update((x) => {
    x.emulators = { apps: [], paths: { roms: join(dir, 'roms'), emulators: join(dir, 'emu'), saves: join(dir, 'saves') } }
  })
  const downloads = new EmulatorDownloads(join(dir, 'config', 'emulators'))
  const { next } = await applyConsoles(settings, null, downloads, ['pcsx2', 'cemu'], [], me)
  assert.deepEqual(next.apps.sort(), ['cemu', 'pcsx2'])
  assert.deepEqual(next.install, ['cemu'], 'only Cemu is Finesse’s to download')
  const v = consoleViews(settings.get(), downloads).find((c) => c.id === 'pcsx2')!
  assert.equal(v.added, true)
  assert.equal(v.own, true)
})

test('adding the Switch keeps a chosen Ryujinx; Eden only when none was chosen', () => {
  const ryu = withConsoles({ mode: 'adopt', emulators: { apps: ['switch'], switchEmulator: 'ryujinx', paths: { roms: '/r', emulators: '/nowhere', saves: '/s' } } } as never, ['eden'], [], '/m')
  assert.equal(ryu.switchEmulator, 'ryujinx')
  const none = withConsoles({ mode: 'adopt', emulators: { apps: [], paths: { roms: '/r', saves: '/s' } } } as never, ['eden'], [], '/m')
  assert.equal(none.switchEmulator, 'eden')
})

test('where Finesse’s downloads are on the server: its own container’s mounts; unset (and said) when none holds them', async () => {
  const docker = (mounts: { Source: string; Destination: string }[], name?: string[]) =>
    ({ inspect: async (n: string) => (name?.push(n), { Mounts: mounts }) }) as never
  const asked: string[] = []
  process.env.FINESSE_CONTAINER = 'finesse-test'
  try {
    assert.equal(await hostPathOf(docker([{ Source: '/mnt/tank/finesse/config', Destination: '/config' }], asked), '/config/emulators'), '/mnt/tank/finesse/config/emulators')
    assert.deepEqual(asked, ['finesse-test'])
  } finally {
    delete process.env.FINESSE_CONTAINER
  }
  assert.equal(await hostPathOf(docker([{ Source: '/x', Destination: '/data' }]), '/config/emulators'), null)
  assert.equal(await hostPathOf(null, '/config/emulators'), '/config/emulators', 'outside Docker it is itself')
  const s = { mode: 'adopt', emulators: { apps: ['pcsx2'], paths: { roms: '/r', saves: '/s' } } } as never
  const e = withConsoles(s, ['pcsx2'], [], undefined)
  assert.equal(e.managedDir, undefined, 'never a container path')
  assert.match(consoleNotes({ emulators: e } as never)[0]!, /can’t tell where its emulators folder is/)
  assert.deepEqual(consoleNotes({ emulators: { ...e, managedDir: '/m' } } as never), [])
})

test('folders: only missing ones are made, and only those change owner; the saves top and your own folders never', (t) => {
  if (process.getuid?.() !== 0) {
    // Without root a chown to someone else fails: that's said, plainly, and nothing is opened up to everyone.
    const dir = tmp('emuapi-folders-')
    const e: EmulatorSettings = { apps: ['pcsx2'], paths: { roms: join(dir, 'roms'), firmware: join(dir, 'fw'), saves: join(dir, 'saves') } }
    const notes = makeFolders(e, { uid: 4242, gid: 4242 })
    assert.ok(existsSync(join(dir, 'fw', 'pcsx2')))
    assert.equal(statSync(join(dir, 'fw', 'pcsx2')).mode & 0o777 & 0o002, 0, 'no 0777 fallback')
    assert.match(notes[0]!, /couldn’t give it to the apps’ user/)
    // Already there: left alone, nothing to say.
    assert.deepEqual(makeFolders(e, { uid: 4242, gid: 4242 }), [])
    return t.diagnostic('not root: ownership checked by the failure path only')
  }
  const dir = tmp('emuapi-folders-')
  mkdirSync(join(dir, 'saves'))
  mkdirSync(join(dir, 'fw', 'rpcs3'), { recursive: true })
  mkdirSync(join(dir, 'mybios'))
  const e: EmulatorSettings = { apps: ['pcsx2', 'rpcs3', 'switch'], switchEmulator: 'eden', paths: { roms: join(dir, 'roms'), firmware: join(dir, 'fw'), keys: join(dir, 'keys'), saves: join(dir, 'saves') }, folders: { switch: { keys: join(dir, 'mykeys') }, pcsx2: { firmware: join(dir, 'mybios') } } }
  assert.deepEqual(makeFolders(e, { uid: 4242, gid: 4343 }), [])
  const uid = (p: string) => statSync(join(dir, p)).uid
  assert.equal(uid('saves'), 0, 'the top of saves is never chowned')
  assert.equal(uid('fw/rpcs3'), 0, 'a folder that was there keeps its owner')
  assert.equal(uid('fw/switch'), 4242, 'made by Finesse: the apps’ user’s')
  assert.equal(uid('keys'), 4242)
  assert.equal(uid('mybios'), 0, 'your own folder is yours')
  assert.ok(!existsSync(join(dir, 'mykeys')), 'your own folder isn’t made for you')
})

test('removing while a download is being checked is refused (the request checks every console first)', async () => {
  const d = new EmulatorDownloads(tmp('emudl-busy-'))
  ;(d as unknown as { running: Map<string, { state: string; received: number }> }).running.set('cemu', { state: 'checking', received: 1 })
  assert.match(d.busy('cemu')!, /checking/)
  assert.throws(() => d.remove('cemu'), /checking/)
  assert.equal(d.busy('pcsx2'), null)
})

test('each need names its folder, optional ones too, and the Windows label replaces the data folder', () => {
  const dir = tmp('emuapi-label-')
  for (const d of ['games/keys/cemu', 'games/saves', 'media/games/roms']) mkdirSync(join(dir, d), { recursive: true })
  const s = { mode: 'bundle', stack: { hostData: dir }, emulators: { apps: ['cemu'], paths: { roms: join(dir, 'media/games'), keys: join(dir, 'games/keys'), firmware: join(dir, 'games/firmware'), saves: join(dir, 'games/saves') }, install: ['cemu'], managedDir: '/m' } } as never
  const d = new EmulatorDownloads(join(dir, 'managed'))
  const keys = consoleViews(s, d).find((c) => c.id === 'cemu')!.needs.find((n) => n.label === 'keys.txt')!
  assert.equal(keys.required, false)
  assert.equal(keys.folder, join(dir, 'games/keys/cemu'))
  assert.equal(withoutFolder('Encrypted discs need it. Put it in /mnt/My Games/keys/cemu.'), 'Encrypted discs need it.')
  process.env.FINESSE_DATA_LABEL = 'D:\\Finesse\\'
  try {
    assert.equal(consoleViews(s, d).find((c) => c.id === 'cemu')!.needs.find((n) => n.label === 'keys.txt')!.folder, 'D:\\Finesse\\games\\keys\\cemu')
    assert.equal(folderLabel(s, '/elsewhere/x'), '/elsewhere/x')
  } finally {
    delete process.env.FINESSE_DATA_LABEL
  }
})

test('a community build is labelled wherever it’s offered (setup’s picker and Settings)', () => {
  for (const p of EMULATOR_PINS) assert.equal(Boolean(COMMUNITY_BUILD[p.id]), !p.official, p.id)
  assert.match(COMMUNITY_BUILD.dolphin!, /community build \(Dolphin has no official Linux download\)/)
})

test('ES-DE: your own emulator is the one in ~/Applications; Finesse’s copy only where you have none', () => {
  const dir = tmp('emuapi-esde-')
  const own = join(dir, 'own')
  const managed = join(dir, 'managed')
  const H = join(dir, 'home')
  mkdirSync(own, { recursive: true })
  mkdirSync(managed, { recursive: true })
  writeFileSync(join(own, 'PCSX2-v2.0.AppImage'), '')
  for (const f of ['pcsx2-v2.8.2-linux-appimage-x64-Qt.AppImage', 'Cemu-2.6-x86_64.AppImage']) writeFileSync(join(managed, f), '')
  const cat = emulatorCatalog('eden')
  const run = () => execFileSync('bash', ['-e', '-c', `shopt -s nullglob nocaseglob\n${esdeLinks(Object.values(cat), H, own, managed)}`])
  // From before: a link to Finesse's PCSX2, made when you had none of your own.
  mkdirSync(join(H, 'Applications'), { recursive: true })
  symlinkSync(join(managed, 'pcsx2-v2.8.2-linux-appimage-x64-Qt.AppImage'), join(H, 'Applications', 'pcsx2-v2.8.2-linux-appimage-x64-Qt.AppImage'))
  writeFileSync(join(H, 'Applications', 'esde.AppImage'), '')
  run()
  run()
  const there = readdirSync(join(H, 'Applications')).sort()
  assert.deepEqual(there, ['Cemu-2.6-x86_64.AppImage', 'PCSX2-v2.0.AppImage', 'esde.AppImage'])
  assert.equal(readlinkSync(join(H, 'Applications', 'PCSX2-v2.0.AppImage')), join(own, 'PCSX2-v2.0.AppImage'))
})

test('system saves on an upgrade: the home’s data moves into the saves folder once, never hidden or lost', () => {
  const dir = tmp('emuapi-stage-')
  const H = join(dir, 'home')
  const stage = join(dir, 'stage')
  const eden = emulatorCatalog('eden', H).switch
  const st = join(stage, 'switch', 'system')
  const home = join(H, '.local/share/eden/nand/system/save')
  const run = () => execFileSync('bash', ['-e', '-c', stageSaves(eden, stage)], { stdio: 'pipe' })
  // A home from before (browser play's volume): the user profile lives in nand/system/save.
  mkdirSync(join(home, '8000000000000010/su/avators'), { recursive: true })
  writeFileSync(join(home, '8000000000000010/su/avators/profiles.dat'), 'the player’s account')
  mkdirSync(st, { recursive: true }) // the empty folder Docker mounts there
  // The mount points at the staging folder, not over the home's data.
  assert.ok(appMounts('switch', { apps: ['switch'], switchEmulator: 'eden', paths: { roms: '/r', saves: '/s' } }, 'user', H).includes('/s/user/switch/system:/finesse/saves/switch/system:rw'))
  run()
  assert.equal(readlinkSync(home), st)
  assert.equal(readFileSync(join(home, '8000000000000010/su/avators/profiles.dat'), 'utf8'), 'the player’s account', 'still there, through the link')
  assert.equal(readFileSync(join(st, '8000000000000010/su/avators/profiles.dat'), 'utf8'), 'the player’s account')
  assert.equal(statSync(join(st, '8000000000000010')).uid, statSync(join(dir)).uid, 'ownership kept')
  run()
  assert.equal(readlinkSync(home), st, 'idempotent')
  // A fresh home: just the link.
  const fresh = emulatorCatalog('eden', join(dir, 'fresh')).switch
  execFileSync('bash', ['-e', '-c', stageSaves(fresh, stage)])
  assert.equal(readlinkSync(join(dir, 'fresh/.local/share/eden/nand/system/save')), st)
  // Both have data (saves made elsewhere since): the home's copy is kept beside it.
  const other = join(dir, 'other')
  const oh = join(other, '.local/share/eden/nand/system/save')
  mkdirSync(oh, { recursive: true })
  writeFileSync(join(oh, 'mine'), 'x')
  execFileSync('bash', ['-e', '-c', stageSaves(emulatorCatalog('eden', other).switch, stage)])
  assert.equal(readlinkSync(oh), st)
  const kept = readdirSync(join(other, '.local/share/eden/nand/system')).find((n) => n.startsWith('save.finesse-kept-'))!
  assert.equal(readFileSync(join(other, '.local/share/eden/nand/system', kept, 'mine'), 'utf8'), 'x')
  // Ryujinx's system saves and Dolphin's save states go the same way.
  assert.deepEqual(emulatorCatalog('ryujinx').switch.staged, ['system'])
  assert.deepEqual(emulatorCatalog().dolphin.staged, ['StateSaves'])
  const prep = wolfApp('dolphin', { settings: { apps: ['dolphin'], paths: { roms: '/r', saves: '/s' } }, profile: 'user', base: {} as never })
  assert.match((prep.runner as { env: string[] }).env.find((x) => x.startsWith('FINESSE_PREP='))!, /stage_saves '\/finesse\/saves\/dolphin\/StateSaves' '\/home\/retro\/\.local\/share\/dolphin-emu\/StateSaves'/)
})
