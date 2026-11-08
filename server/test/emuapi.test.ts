// Settings → Consoles and setup's consoles, against a scratch settings file:
// a setup re-run keeps what Settings changed, removing works with your own
// emulators folder, folders are made (and owned) only when Finesse made them.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { SettingsStore } from '../src/config.ts'
import { applyConsoles, setupConsoles } from '../src/emuapi.ts'
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
