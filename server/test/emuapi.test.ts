// Settings → Consoles and setup's consoles, against a scratch settings file:
// a setup re-run keeps what Settings changed, removing works with your own
// emulators folder, folders are made (and owned) only when Finesse made them.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SettingsStore } from '../src/config.ts'
import { applyConsoles, consoleNotes, consoleViews, folderLabel, hostPathOf, makeFolders, setupConsoles, withConsoles } from '../src/emuapi.ts'
import { withoutFolder } from '../../src/lib/consoleText.ts'
import { EmulatorDownloads } from '../src/emudownload.ts'
import type { EmulatorSettings } from '../src/emulators.ts'
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
