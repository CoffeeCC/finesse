// The install engine with a pretend sandbox. Each case replays what the lab saw a real installer
// do (tools/installer-lab/results-*.txt, real-results.txt): the 8 worst-case Inno installers and
// the free games (Warzone 2100, SuperTux, 0 A.D., OpenTTD), and checks the engine decides the
// same way, plus the paths the lab's script didn't have yet (clicking through, "needs you").

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerWindow, failureReason, reasonFromLog, silentCommand } from '../src/gamestore/answers.ts'
import { finishAfterPerson, install, INSTALLED, pickInstaller, planInstall, UNPACKED, type InstallJob } from '../src/gamestore/install.ts'
import { findProgram, programNames } from '../src/gamestore/program.ts'
import type { JobFile, LaunchResult, RunResult, SandboxRunner, SurveyedFile, UnpackTool, WindowInfo } from '../src/gamestore/types.ts'
import type { Sniffed } from '../src/installerSniff.ts'

const MIB = 1024 * 1024
const inno = (version = '6.2.2'): Sniffed => ({ kind: 'inno', format: `Inno Setup ${version}`, version, unpack: 'innoextract', silent: [], notes: [] })
const nsis: Sniffed = { kind: 'nsis', format: 'NSIS installer', unpack: '7z', silent: [], notes: [] }
const msi: Sniffed = { kind: 'msi', format: 'Windows Installer package (MSI)', unpack: 'msiextract', notes: [] }
const zip: Sniffed = { kind: 'archive', format: 'zip archive', unpack: '7z', notes: [] }
const plain: Sniffed = { kind: 'unknown', format: 'Windows program', notes: ['Nothing appended after the program: the game may be in files next to it.'] }
const mystery: Sniffed = { kind: 'unknown', format: 'Windows program', notes: ['A large block of data is appended that Finesse doesn’t recognise: probably an installer it doesn’t know.'] }
const other: Sniffed = { kind: 'unknown', format: 'Unrecognised file', notes: [] }

const win = (title: string, more: Partial<WindowInfo> = {}): WindowInfo => ({ title, class: 'GameWindow', text: '', buttons: [], wantsInput: false, ...more })
const box = (title: string, text: string, buttons: string[], more: Partial<WindowInfo> = {}): WindowInfo => ({ title, class: '#32770', text, buttons, wantsInput: false, ...more })
const ok: RunResult = { exit: 0, hung: false, log: '' }
const GAME = [{ path: 'app/game.exe', size: 5 * MIB }, { path: 'app/unins000.exe', size: 9 * MIB }, { path: 'app/data.pak', size: 80 * MIB }]

interface Script {
  host?: 'linux' | 'windows'
  maxInno?: string
  /** What a file is, by its job-relative path's ending. */
  sniff: Record<string, Sniffed>
  listing?: string[]
  unpack?: (tool: string, file: string) => RunResult & { files?: JobFile[] }
  silent?: (command: string[]) => RunResult & { files?: JobFile[] }
  /** A shown install: the windows it puts up one after another (each until its button is pressed), then its result. */
  shown?: { pages: WindowInfo[]; result?: RunResult & { files?: JobFile[] } }
  /** What starting the game shows, per folder it was started from. */
  launch?: (program: string) => Partial<LaunchResult> & { then?: WindowInfo[] }
}

function sandbox(s: Script) {
  const folders = new Map<string, JobFile[]>()
  const did: string[] = []
  let screen: WindowInfo[] = []
  let afterClick: WindowInfo[] | undefined
  let pages: WindowInfo[] = []
  let finish: (() => void) | null = null
  let progress: ((bytes: number) => void) | undefined
  let reads = 0
  const turn = () => {
    pages.shift()
    reads = 0
    screen = pages.length ? [pages[0]!] : []
    if (!pages.length) finish?.()
  }
  const runner: SandboxRunner = {
    host: s.host ?? 'linux',
    supports: (tool: UnpackTool) => (tool === 'innoextract' ? { maxVersion: s.maxInno ?? '6.3.3' } : {}),
    list: async () => s.listing ?? [],
    unpack: async (tool, file, into) => {
      did.push(`unpack ${tool} ${file}`)
      const r = s.unpack?.(tool, file) ?? { ...ok, files: GAME }
      if (r.exit === 0) folders.set(into, [...(folders.get(into) ?? []), ...(r.files ?? [])])
      return r
    },
    install: async (command, opts) => {
      did.push(`${opts.shown ? 'shown' : 'silent'} ${command.join(' ')}`)
      if (!opts.shown) {
        const r = s.silent?.(command) ?? { ...ok, files: GAME.map((f) => ({ ...f, path: f.path.replace('app/', '') })) }
        if (r.exit === 0 && !r.hung) folders.set(r.dir ?? INSTALLED, r.files ?? [])
        return r
      }
      pages = [...(s.shown?.pages ?? [])]
      progress = opts.onProgress
      screen = pages.length ? [pages[0]!] : []
      return new Promise<RunResult>((resolve) => {
        finish = () => {
          const r = s.shown?.result ?? { ...ok, files: [{ path: 'game.exe', size: 5 * MIB }] }
          if (r.exit === 0) folders.set(INSTALLED, r.files ?? [])
          screen = []
          resolve(r)
        }
        if (!pages.length) finish()
      })
    },
    files: async (dir) => folders.get(dir) ?? [],
    clear: async (dir) => void folders.delete(dir),
    launch: async (program) => {
      did.push(`launch ${program}`)
      const r = s.launch?.(program) ?? { windows: [win('Game')], screenshot: 'shot.png' }
      screen = r.windows ?? []
      afterClick = r.then
      return { windows: screen, log: '', ...r }
    },
    windows: async () => {
      // A page with no button is the installer copying files: it writes for a while (longer
      // than the hang limit), then moves on by itself.
      const now = screen
      if (pages.length && !pages[0]!.buttons.length) {
        progress?.(++reads * MIB)
        if (reads >= 20) turn()
      }
      return now
    },
    click: async (w, button) => {
      did.push(`click ${button}`)
      if (pages.length) turn()
      else if (afterClick) {
        screen = afterClick
        afterClick = undefined
      } else screen = screen.filter((x) => x !== w)
      return true
    },
    stop: async () => {
      did.push('stop')
      screen = []
    },
  }
  const job = (files: JobFile[], more: Partial<InstallJob> = {}): InstallJob => ({
    runner,
    title: 'Stand-in Game',
    files,
    sniff: async (path) => Object.entries(s.sniff).find(([end]) => path.endsWith(end))?.[1] ?? other,
    pollMs: 0,
    hangAfterMs: 5,
    sleep: () => new Promise((r) => setImmediate(r)),
    ...more,
  })
  return { runner, job, did, folders }
}

const setup = [{ path: 'setup.exe', size: 30 * MIB }]

// ---------- the lab's 8 ----------

test('01–03 plain, spanned and heavily compressed Inno installers: ready by unpacking, the installer never runs', async () => {
  for (const files of [setup, [...setup, { path: 'setup-1.bin', size: 300 * MIB }, { path: 'setup-2.bin', size: 45 * MIB }]]) {
    const s = sandbox({ sniff: { 'setup.exe': inno() } })
    const out = await install(s.job(files))
    assert.deepEqual([out.state, out.state === 'ready' && out.by, out.state === 'ready' && out.program, out.state === 'ready' && out.dir], ['ready', 'unpack', 'app/game.exe', UNPACKED])
    assert.equal(s.did.some((d) => d.startsWith('silent') || d.startsWith('shown')), false)
    assert.equal(s.did.at(-1), 'stop', 'the game is stopped after the check')
  }
})

test('04 a page that must be filled in: unpacking gets there; when it can’t, the silent run hangs, clicking reaches the page, and a person is asked', async () => {
  const s = sandbox({ sniff: { 'setup.exe': inno() } })
  assert.equal((await install(s.job(setup))).state, 'ready')

  const page = box('Setup - Stand-in Game', 'Player details. Please enter your player name, then click Next.', ['< &Back', '&Next >', 'Cancel'], { wantsInput: true })
  const t = sandbox({
    sniff: { 'setup.exe': inno('6.7.0') },
    silent: () => ({ exit: null, hung: true, log: '' }),
    shown: { pages: [box('Setup - Stand-in Game', 'Welcome to the Stand-in Game Setup Wizard', ['&Next >', 'Cancel']), page] },
  })
  const out = await install(t.job(setup))
  assert.equal(out.state, 'needs-you')
  assert.equal(out.state === 'needs-you' && out.waitingOn, 'Setup - Stand-in Game')
  assert.match(out.state === 'needs-you' ? out.why : '', /enter your player name/)
  assert.deepEqual(t.did.filter((d) => /^(unpack|silent|shown|click)/.test(d)).map((d) => d.split(' ').slice(0, 2).join(' ')), ['silent download/setup.exe', 'shown download/setup.exe', 'click &Next'])
  assert.notEqual(t.did.at(-1), 'stop', 'the installer is left running for the person')

  // They finish it on its screen; then it's found and started like any other.
  t.folders.set(INSTALLED, [{ path: 'game.exe', size: 5 * MIB }])
  const done = await finishAfterPerson(t.job(setup))
  assert.deepEqual([done.state, done.state === 'ready' && done.by], ['ready', 'needs-you'])
})

test('05 an installer that refuses to run silently (when it can’t be unpacked): clicked through', async () => {
  const s = sandbox({
    sniff: { 'setup.exe': inno('6.7.0') },
    silent: () => ({ exit: 1, hung: false, log: '2026-01-01 10:00:00.000   This installer refuses to run silently.\n2026-01-01 10:00:00.100   Setup exit code: 1' }),
    shown: {
      pages: [
        box('Setup', 'Welcome', ['&Next >', 'Cancel']),
        box('Setup', 'Select Destination Location. Where should Stand-in Game be installed?', ['< &Back', '&Next >', 'Cancel'], { wantsInput: true }),
        box('Setup', 'Ready to Install', ['< &Back', '&Install', 'Cancel']),
        box('Setup', 'Installing…', []),
        box('Setup', 'Completing the Setup Wizard', ['&Finish']),
      ],
    },
  })
  // The progress page has no button and takes longer than the hang limit: files are being
  // written, so it isn't stuck.
  const r = await install(s.job(setup))
  assert.deepEqual([r.state, r.state === 'ready' && r.by], ['ready', 'auto-click'])
  assert.deepEqual(s.did.filter((d) => d.startsWith('click &')), ['click &Next >', 'click &Next >', 'click &Install', 'click &Finish'])
  assert.ok(r.log.some((l) => l.includes('refuses to run silently')))
})

test('06 an installer that runs a runtime of its own (tmp/ in its listing): run silently first', async () => {
  const s = sandbox({ sniff: { 'setup.exe': inno() }, listing: ['app/game.exe', 'tmp/runtime-setup.exe'] })
  const out = await install(s.job(setup))
  assert.deepEqual([out.state, out.state === 'ready' && out.by, out.state === 'ready' && out.dir], ['ready', 'silent', INSTALLED])
  assert.equal(s.did.some((d) => d.startsWith('unpack')), false)
  assert.match(s.did.find((d) => d.startsWith('silent'))!, /^silent download\/setup\.exe \/VERYSILENT \/SUPPRESSMSGBOXES \/NORESTART \/SP- \/ALLUSERS \/DIR=<dir> \/LOG=<log>$/)
})

test('07 an installer that wants the internet (when it can’t be unpacked): its own reason is the reason', async () => {
  const s = sandbox({
    sniff: { 'setup.exe': inno('6.7.0') },
    silent: () => ({ exit: 7, hung: false, log: '2026-01-01 10:00:00.000   Couldn’t download the extra content.\n2026-01-01 10:00:00.100   Setup exit code: 7' }),
    shown: { pages: [box('Setup', 'Couldn’t download the extra content.', ['OK'])] },
  })
  const out = await install(s.job(setup))
  assert.deepEqual([out.state, out.state === 'failed' && out.reason], ['failed', 'Setup: Couldn’t download the extra content.'])
  assert.equal(s.did.at(-1), 'stop')
})

test('08 a game that’s broken: unpacked, then installed, and it still won’t start: didn’t work, with why', async () => {
  const s = sandbox({ sniff: { 'setup.exe': inno() }, launch: () => ({ windows: [], exited: 1, log: 'fixme:ntdll nothing\nmissing level data' }) })
  const out = await install(s.job(setup))
  assert.deepEqual([out.state, out.state === 'failed' && out.reason], ['failed', 'The game doesn’t start. It closed straight away: missing level data'])
  assert.deepEqual(s.did.filter((d) => /^(unpack|silent|shown)/.test(d)).map((d) => d.split(' ')[0]), ['unpack', 'silent'], 'clicking through the same installer wouldn’t help')
})

// ---------- the free games ----------

test('Warzone 2100 (Inno 6.7, newer than the unpacker reads): silent install; a notice box at start is answered', async () => {
  const s = sandbox({
    sniff: { 'warzone2100_win_installer.exe': inno('6.7.0') },
    silent: () => ({ ...ok, files: [{ path: 'bin/warzone2100.exe', size: 20 * MIB }, { path: 'bin/crashpad_handler.exe', size: 30 * MIB }, { path: 'unins000.exe', size: 3 * MIB }] }),
    launch: () => ({ windows: [box('Warzone 2100', 'Native Linux builds are available.', ['OK'])], screenshot: 'shot.png', then: [win('Warzone 2100')] }),
  })
  const out = await install(s.job([{ path: 'warzone2100_win_installer.exe', size: 200 * MIB }], { title: 'Warzone 2100' }))
  assert.deepEqual([out.state, out.state === 'ready' && out.by, out.state === 'ready' && out.program], ['ready', 'silent', 'bin/warzone2100.exe'])
  assert.ok(out.log.some((l) => l.includes('newer than the unpacker reads (up to 6.3.3)')))
  assert.ok(s.did.includes('click OK'))
})

test('SuperTux (MSI): ready by unpacking', async () => {
  const s = sandbox({ sniff: { '.msi': msi }, unpack: () => ({ ...ok, files: [{ path: 'SuperTux/bin/supertux2.exe', size: 9 * MIB }, { path: 'SuperTux/bin/SDL2.dll', size: 12 * MIB }] }) })
  const out = await install(s.job([{ path: 'SuperTux-v0.7.0-win64.msi', size: 150 * MIB }], { title: 'SuperTux' }))
  assert.deepEqual([out.state, out.state === 'ready' && out.by, out.state === 'ready' && out.program], ['ready', 'unpack', 'SuperTux/bin/supertux2.exe'])
  assert.equal(s.did[0], 'unpack msiextract download/SuperTux-v0.7.0-win64.msi')
})

test('0 A.D. (NSIS the unpacker can’t open): silent install, /D= last; a crash box at start is the reason it didn’t work', async () => {
  const files = [{ path: 'binaries/system/pyrogenesis.exe', size: 40 * MIB }, { path: 'binaries/system/ActorEditor.exe', size: 1 * MIB }, { path: 'Uninstall.exe', size: 1 * MIB }]
  const script = { sniff: { '.exe': nsis }, unpack: () => ({ exit: 2, hung: false, log: 'ERROR: Can not open the file as archive' }), silent: () => ({ ...ok, files }) }
  const s = sandbox(script)
  const out = await install(s.job([{ path: '0ad-0.28.0-win64.exe', size: 1500 * MIB }], { title: '0 A.D.' }))
  assert.deepEqual([out.state, out.state === 'ready' && out.by, out.state === 'ready' && out.program], ['ready', 'silent', 'binaries/system/pyrogenesis.exe'])
  assert.equal(s.did.find((d) => d.startsWith('silent')), 'silent download/0ad-0.28.0-win64.exe /S /D=<dir>')

  const crash = sandbox({ ...script, launch: () => ({ windows: [box('Program Error', 'Much to our regret we must report the program has encountered an error.', ['OK'])], screenshot: 'shot.png' }) })
  const bad = await install(crash.job([{ path: '0ad-0.28.0-win64.exe', size: 1500 * MIB }]))
  assert.equal(bad.state, 'failed')
  assert.match(bad.state === 'failed' ? bad.reason : '', /^The game doesn’t start\. Program Error: Much to our regret/)
})

test('OpenTTD (NSIS that opens): ready by unpacking; the installer’s own folder is ignored', async () => {
  const s = sandbox({ sniff: { '.exe': nsis }, unpack: () => ({ ...ok, files: [{ path: 'openttd.exe', size: 15 * MIB }, { path: '$PLUGINSDIR/nsDialogs.exe', size: 20 * MIB }] }) })
  const out = await install(s.job([{ path: 'openttd-14.1-windows-win64.exe', size: 60 * MIB }], { title: 'OpenTTD' }))
  assert.deepEqual([out.state, out.state === 'ready' && out.program], ['ready', 'openttd.exe'])
})

// ---------- other shapes of download ----------

test('a zip of the game; a zip with an installer inside; a Linux build; a game that’s just a folder', async () => {
  const a = sandbox({ sniff: { '.zip': zip }, unpack: () => ({ ...ok, files: [{ path: 'Game/game.exe', size: 5 * MIB }] }) })
  assert.deepEqual(await install(a.job([{ path: 'game.zip', size: 50 * MIB }])).then((o) => [o.state, o.state === 'ready' && o.by]), ['ready', 'unpack'])

  const b = sandbox({ sniff: { '.zip': zip, 'Setup.exe': inno() }, unpack: (tool) => (tool === '7z' ? { ...ok, files: [{ path: 'Setup.exe', size: 40 * MIB }, { path: 'readme.txt', size: 100 }] } : { ...ok, files: GAME }) })
  const inner = await install(b.job([{ path: 'game.zip', size: 50 * MIB }]))
  assert.deepEqual([inner.state, inner.state === 'ready' && inner.dir], ['ready', `${UNPACKED}-1`])
  assert.deepEqual(b.did.filter((d) => d.startsWith('unpack')), ['unpack 7z download/game.zip', `unpack innoextract ${UNPACKED}/Setup.exe`])

  const tar: Sniffed = { kind: 'archive', format: 'xz archive (often .tar.xz)', unpack: 'tar', notes: [] }
  const c = sandbox({ sniff: { '.tar.xz': tar }, unpack: () => ({ ...ok, files: [{ path: 'supertuxkart/run_game.sh', size: 2000, executable: true }, { path: 'supertuxkart/bin/supertuxkart', size: 30 * MIB, executable: true }, { path: 'supertuxkart/lib/libopenal.so.1', size: 2 * MIB, executable: true }] }) })
  const linux = await install(c.job([{ path: 'SuperTuxKart-1.4-linux-x86_64.tar.xz', size: 600 * MIB }], { title: 'SuperTuxKart', platform: 'linux' }))
  assert.deepEqual([linux.state, linux.state === 'ready' && linux.program], ['ready', 'supertuxkart/run_game.sh'])

  const d = sandbox({ sniff: { '.exe': plain }, unpack: () => ({ ...ok, files: [{ path: 'Game.exe', size: 3 * MIB }, { path: 'data/level1.dat', size: 90 * MIB }] }) })
  const folder = await install(d.job([{ path: 'Game.exe', size: 3 * MIB }, { path: 'data/level1.dat', size: 90 * MIB }]))
  assert.deepEqual([folder.state, d.did[0]], ['ready', 'unpack copy download'])
})

test('an installer nobody knows, with its data in ordinary archives next to it: those are unpacked first; else it’s clicked through', async () => {
  const files = [{ path: 'setup.exe', size: 2 * MIB }, { path: 'data-1.bin', size: 900 * MIB }, { path: 'data-2.bin', size: 400 * MIB }]
  const s = sandbox({ sniff: { 'setup.exe': plain, '.bin': zip } })
  const out = await install(s.job(files))
  assert.deepEqual([out.state, out.state === 'ready' && out.by], ['ready', 'unpack'])
  assert.deepEqual(s.did.slice(0, 2), ['unpack 7z download/data-1.bin', 'unpack 7z download/data-2.bin'])

  // Private data: nothing to unpack, so the installer runs with its windows.
  const t = sandbox({ sniff: { 'setup.exe': mystery }, shown: { pages: [box('Installer', 'Ready', ['Install', 'Exit']), box('Installer', 'All done', ['Close'])] } })
  const clicked = await install(t.job(files))
  assert.deepEqual([clicked.state, clicked.state === 'ready' && clicked.by], ['ready', 'auto-click'])
  assert.equal(t.did[0], 'shown download/setup.exe')
})

test('nothing to install; a start with no window; a blank screen', async () => {
  const none = await install(sandbox({ sniff: {} }).job([{ path: 'readme.txt', size: 10 }]))
  assert.deepEqual([none.state, none.state === 'failed' && none.reason], ['failed', 'There’s no installer, archive or game program in this download.'])
  const silentOnly = (launch: Script['launch']) => install(sandbox({ sniff: { 'setup.exe': inno() }, launch }).job(setup))
  const noWindow = await silentOnly(() => ({ windows: [] }))
  assert.match(noWindow.state === 'failed' ? noWindow.reason : '', /never opened a window/)
  const blank = await silentOnly(() => ({ windows: [win('Game')] }))
  assert.match(blank.state === 'failed' ? blank.reason : '', /screen stayed blank/)
})

// ---------- the pure parts ----------

test('choosing what to start from', () => {
  const f = (path: string, sniffed: Sniffed, size = 10 * MIB): SurveyedFile => ({ path, size, sniffed })
  const elf: Sniffed = { kind: 'linux', format: 'AppImage', notes: [] }
  const both = [f('Game-win.exe', nsis), f('Game.AppImage', elf), f('extras/soundtrack.zip', zip, 900 * MIB)]
  assert.equal(pickInstaller(both)!.path, 'Game-win.exe')
  assert.equal(pickInstaller(both, { platform: 'linux' })!.path, 'Game.AppImage')
  assert.equal(pickInstaller(both, { hint: 'extras\\soundtrack.zip' })!.path, 'extras/soundtrack.zip')
  assert.equal(pickInstaller([f('game.part2.rar', zip, 500 * MIB), f('game.part1.rar', zip, 400 * MIB)])!.path, 'game.part1.rar')
  assert.equal(pickInstaller([f('redist/vc_redist.x64.exe', inno(), 25 * MIB), f('setup.exe', inno(), 5 * MIB)])!.path, 'setup.exe', 'nearest the top wins')
  assert.equal(pickInstaller([f('notes.bin', other)]), null)
  // Windows installs for the current user (no administrator); Wine for all users.
  assert.ok(silentCommand('s.exe', inno(), 'windows')!.includes('/CURRENTUSER'))
  assert.deepEqual(planInstall(f('setup.exe', { ...msi, format: 'WiX bundle (several MSI packages)', unpack: '7z' }), { host: 'linux' }).steps.map((s) => s.tier), ['silent', 'auto-click'])
  assert.deepEqual(planInstall(f('install.sh', { kind: 'linux', format: 'Linux shell script', notes: [] }), { host: 'linux' }).steps, [])
})

test('finding the game’s program', () => {
  const files = [
    { path: 'unins000.exe', size: 90 },
    { path: 'vc_redist.x64.exe', size: 80 },
    { path: 'CrashReporter.exe', size: 70 },
    { path: '_Redist/dxsetup.exe', size: 60 },
    { path: 'tmp/extractor.exe', size: 65 },
    { path: 'bin/editor.exe', size: 50 },
    { path: 'bin/standin.exe', size: 20 },
  ]
  assert.equal(findProgram(files)!.path, 'bin/editor.exe', 'the biggest that isn’t a helper')
  assert.equal(findProgram(files, { names: programNames('Stand-in Game', 'standin-1.0-setup.exe') })!.path, 'bin/standin.exe', 'named like the game')
  assert.equal(findProgram(files, { hint: 'bin\\editor.exe', names: ['standin'] })!.path, 'bin/editor.exe', 'the store’s word wins')
  assert.equal(findProgram([{ path: 'setup.exe', size: 5 }, { path: 'readme.txt', size: 5 }]), null)
  assert.deepEqual(findProgram([{ path: 'game.x86_64', size: 5 }, { path: 'game.exe', size: 9 }], { linux: true }), { path: 'game.x86_64', linux: true })
})

test('answering windows, and reading why an installer failed', () => {
  assert.deepEqual(answerWindow(box('Setup', 'License Agreement', ['I &Agree', 'Cancel'])), { do: 'click', button: 'I &Agree' })
  assert.deepEqual(answerWindow(box('Setup', 'Ready', ['< &Back', '&Install', 'Cancel'])), { do: 'click', button: '&Install' })
  assert.equal(answerWindow(box('Setup', 'Setup was not completed. Exit?', ['Cancel'])).do, 'ask', 'never Cancel')
  assert.equal(answerWindow(box('Setup', 'Enter your serial number', ['&Next >'], { wantsInput: true })).do, 'ask')
  assert.equal(answerWindow(box('Setup', 'Select Destination Location', ['&Next >'], { wantsInput: true }), 'inno').do, 'click', 'the folder was given already')
  assert.deepEqual(answerWindow(box('Setup', 'You must restart your computer now to finish.', ['&Yes', '&No'])), { do: 'click', button: '&No' })
  assert.deepEqual(answerWindow(box('Error', 'Not enough disk space.', ['OK'])), { do: 'error', text: 'Error: Not enough disk space.' })
  assert.equal(reasonFromLog('2026-01-01 10:00:00.000   Starting\n2026-01-01 10:00:01.000   Message box (OK):\n2026-01-01 10:00:01.000   Could not find the data files.\n2026-01-01 10:00:02.000   Setup exit code: 3'), 'Could not find the data files.')
  assert.equal(failureReason('inno', 5, 'fixme:ole nothing'), 'The installer was cancelled part-way.')
  assert.equal(failureReason('msi', 1603, ''), 'The installer hit an error.')
  assert.equal(failureReason('nsis', 2, ''), 'The installer stopped without saying why (code 2).')
})
