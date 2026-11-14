// The install engine: given a finished, checked download, get a game that starts, without a
// person where that's possible. It decides; a SandboxRunner does (a container with no network on
// Linux, Windows Sandbox on Windows), so the same decisions are tested here with a fake runner
// and run for real in the lab (tools/installer-lab).
//
// The ways, in order (what the lab found: docs/agents/game-store-plan.md):
//   1. unpack      open the installer with a tool; nothing from the download runs
//   2. silent      run the installer with its own no-questions switches
//   3. auto-click  run it with its windows and press the buttons that move it on
//   4. needs you   show its screen to a person
// After any of them: find the game's program and start it. Only a real window (not a dialog
// box) with something on screen counts as "it starts".

import { looksPortable, type Sniffed } from '../installerSniff.ts'
import { answerWindow, failureReason, shownCommand, silentCommand, windowWords } from './answers.ts'
import { findProgram, programNames, type FoundProgram } from './program.ts'
import type { GamePlatform, InstallerKind, InstallOutcome, InstallPlan, InstallStep, JobFile, SandboxRunner, SurveyedFile, Tier, UnpackTool, WindowInfo } from './types.ts'

/** Folders of a job. The download is read-only; these two are the only places anything is written. */
export const UNPACKED = 'install/unpacked'
export const INSTALLED = 'install/game'

const MIB = 1024 * 1024
const WORTH_SNIFFING = /\.(exe|msi|bin|iso|zip|7z|rar|001|tar|gz|tgz|xz|zst|bz2|sh|run|appimage|x86_64|x86)$/i
const NAMED_LIKE_AN_INSTALLER = /^(setup|install)/i

export interface InstallJob {
  runner: SandboxRunner
  /** The game's title (to recognise its program by name). */
  title: string
  /** What the download holds, relative to its folder. */
  files: JobFile[]
  /** What a file of the job is, from its bytes (installerSniff.ts). The path is job-relative: "download/setup.exe". */
  sniff(path: string): Promise<Sniffed>
  /** The build that was asked for. */
  platform?: GamePlatform
  /** From the store, when it knows: the installer in the download, and the game's program once installed. */
  installerHint?: string
  programHint?: string
  /** No files written and nothing running for this long = stuck (default 2 minutes). */
  hangAfterMs?: number
  /** How long the game gets to show a window (default 60 s). */
  startWaitMs?: number
  /** How often windows are looked at while clicking through (default 2 s). */
  pollMs?: number
  sleep?(ms: number): Promise<void>
  /** Each thing it does, in plain words, as it does it. */
  onStep?(text: string, tier?: Tier): void
}

// ---------- 1. survey ----------

/** Sniffs the files that could be an installer, an archive or the game: by ending, or by being big. */
export async function survey(files: JobFile[], sniff: (path: string) => Promise<Sniffed>, root = 'download'): Promise<SurveyedFile[]> {
  const worth = files
    .filter((f) => WORTH_SNIFFING.test(f.path) || f.size >= MIB || f.executable)
    .sort((a, b) => b.size - a.size)
    .slice(0, 200)
  const out: SurveyedFile[] = []
  for (const f of worth) out.push({ path: f.path, size: f.size, sniffed: await sniff(`${root}/${f.path}`) })
  return out
}

const depth = (p: string) => p.split('/').length
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
/** Nearest the top of the download first, then the biggest. */
const topThenBiggest = (a: SurveyedFile, b: SurveyedFile) => depth(a.path) - depth(b.path) || b.size - a.size || a.path.localeCompare(b.path)
/** The first volume of a split archive stands for the set. */
const laterVolume = (p: string) => /\.part(?!0*1\.)\d+\.rar$/i.test(p) || /\.(r\d\d|0(?!01)\d\d|[1-9]\d\d)$/i.test(p)

/** What the download starts from: the store's hint, else an installer, else an archive, else the game itself. */
export function pickInstaller(found: SurveyedFile[], opts: { hint?: string; platform?: GamePlatform } = {}): SurveyedFile | null {
  const hint = opts.hint?.replace(/\\/g, '/').toLowerCase()
  if (hint) {
    const named = found.find((f) => f.path.toLowerCase() === hint) ?? found.find((f) => base(f.path).toLowerCase() === base(hint))
    if (named) return named
  }
  const of = (test: (f: SurveyedFile) => boolean) => found.filter(test).sort(topThenBiggest)[0] ?? null
  const linux = () => of((f) => f.sniffed.kind === 'linux')
  const windows = () =>
    of((f) => ['inno', 'nsis', 'msi'].includes(f.sniffed.kind)) ??
    // A program Finesse doesn't know that carries a payload, or is plainly named "setup".
    of((f) => f.sniffed.kind === 'unknown' && /\.exe$/i.test(f.path) && (!looksPortable(f.sniffed) || NAMED_LIKE_AN_INSTALLER.test(base(f.path))) && f.sniffed.format !== 'DOS program or damaged Windows program')
  const archive = () => of((f) => f.sniffed.kind === 'archive' && !laterVolume(f.path))
  const portable = () => of((f) => looksPortable(f.sniffed) && /\.exe$/i.test(f.path))
  return opts.platform === 'linux' ? (linux() ?? archive() ?? windows() ?? portable()) : (windows() ?? archive() ?? portable() ?? linux())
}

// ---------- 2. plan ----------

function newer(version: string, than: string): boolean {
  const a = version.split('.').map(Number)
  const b = than.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/**
 * The steps for this installer, from what the lab found. `listing` is what the unpack tool says
 * is inside (empty when it can't say); `siblings` are the other files of the download.
 */
export function planInstall(installer: SurveyedFile | null, ctx: { host: 'linux' | 'windows'; maxVersion?: (tool: UnpackTool) => string | undefined; listing?: string[]; siblings?: SurveyedFile[]; root?: string }): InstallPlan {
  if (!installer) return { installer: null, kind: 'unknown', format: 'Nothing to install', linux: false, steps: [], notes: ['There’s no installer, archive or game program in this download.'] }
  const s = installer.sniffed
  const file = `${ctx.root ?? 'download'}/${installer.path}`
  const notes = [...s.notes]
  const steps: InstallStep[] = []
  let kind: InstallerKind = s.kind
  const silent = silentCommand(file, s, ctx.host)
  const unpack = (why: string, tool: UnpackTool | 'copy' = s.unpack!, files = [file]): InstallStep => ({ tier: 'unpack', tool, files, why })
  const run = (why: string): InstallStep => ({ tier: 'silent', command: silent!, why })
  const click: InstallStep = { tier: 'auto-click', command: shownCommand(file, s), why: 'Run the installer with its windows and press the buttons that move it on.' }

  if (s.kind === 'linux') {
    if (silent) steps.push(run('A Linux installer that unpacks itself without running what’s inside.'))
    else if (s.format === 'Linux shell script') notes.push('A Linux script Finesse doesn’t know how to run hands-off.')
    else steps.push(unpack('A Linux program: the download is the game.', 'copy', [ctx.root ?? 'download']))
  } else if (looksPortable(s) && !NAMED_LIKE_AN_INSTALLER.test(base(installer.path))) {
    kind = 'portable'
    steps.push(unpack('Nothing is packed inside this program: the download is the game.', 'copy', [ctx.root ?? 'download']))
  } else if (s.kind === 'archive') {
    steps.push(unpack(`A ${s.format}: unpack it.`))
  } else if (s.kind === 'inno' || s.kind === 'nsis' || s.kind === 'msi') {
    const max = s.unpack ? ctx.maxVersion?.(s.unpack) : undefined
    const tooNew = Boolean(s.version && max && newer(s.version, max))
    const bundle = s.format.startsWith('WiX')
    // Files the installer runs itself (runtimes, its own unpackers) show up under tmp/: unpacking
    // would skip them, so run the installer first and keep unpacking as the fallback.
    const runsExtras = (ctx.listing ?? []).some((p) => /^tmp[\\/]/i.test(p))
    if (tooNew) notes.push(`${s.format} is newer than the unpacker reads (up to ${max}), so the installer is run instead.`)
    if (bundle) notes.push('A bundle of several packages: unpacking it gives the packages, not the game, so the installer is run.')
    if (runsExtras) notes.push('This installer runs extra steps of its own, so it’s run rather than unpacked.')
    const canUnpack = Boolean(s.unpack) && !tooNew && !bundle
    if (canUnpack && !runsExtras) steps.push(unpack('Unpack the installer without running it.'))
    if (silent) steps.push(run('Run the installer with its own no-questions switches.'))
    if (canUnpack && runsExtras) steps.push(unpack('Unpack the installer without running it (its extra steps are skipped).'))
    steps.push(click)
  } else {
    // An installer Finesse doesn't know. Its data is often ordinary archives next to it: unpack
    // those ourselves first; then run it and click.
    const archives = (ctx.siblings ?? []).filter((f) => f.path !== installer.path && f.sniffed.kind === 'archive' && f.sniffed.unpack && f.size >= MIB && !laterVolume(f.path))
    const byTool = new Map<UnpackTool, string[]>()
    for (const a of archives.sort((x, y) => x.path.localeCompare(y.path))) byTool.set(a.sniffed.unpack!, [...(byTool.get(a.sniffed.unpack!) ?? []), `${ctx.root ?? 'download'}/${a.path}`])
    if (byTool.size === 1) for (const [tool, files] of byTool) steps.push(unpack('The game’s files are ordinary archives next to the installer: unpack them.', tool, files))
    steps.push(click)
  }
  return { installer: installer.path, kind, format: s.format, linux: s.kind === 'linux', steps, notes }
}

// ---------- 3. the start check ----------

const DIALOG = '#32770'
export type Started = { ok: true; screenshot?: string } | { ok: false; why: string }

/** Starts the game and reads what's on screen: a real window with a picture, or the reason there isn't one. */
export async function startCheck(job: Pick<InstallJob, 'runner' | 'startWaitMs' | 'pollMs' | 'sleep'>, program: string): Promise<Started> {
  const { runner } = job
  const sleep = job.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  try {
    const first = await runner.launch(program, { waitMs: job.startWaitMs ?? 60_000 })
    let windows = first.windows
    // Boxes in front of the game ("a newer version is available", "OK"): answer up to a handful.
    for (let round = 0; round < 6; round++) {
      const real = windows.find((w) => w.class !== DIALOG)
      const boxes = windows.filter((w) => w.class === DIALOG)
      for (const box of boxes) {
        const a = answerWindow(box)
        if (a.do === 'error') return { ok: false, why: a.text }
      }
      if (real && !boxes.length) return first.screenshot ? { ok: true, screenshot: first.screenshot } : { ok: false, why: 'It opened, but the screen stayed blank.' }
      if (!boxes.length) {
        if (first.exited !== undefined) return { ok: false, why: reasonOrCode(first.log, first.exited) }
        return { ok: false, why: 'It ran, but never opened a window.' }
      }
      const box = boxes[0]!
      const a = answerWindow(box)
      if (a.do !== 'click' || !(await runner.click(box, a.button))) {
        // A real window behind a box nobody can answer still isn't a game anyone can play unattended.
        return { ok: false, why: `It stopped at a window asking: ${windowWords(box)}` }
      }
      await sleep(job.pollMs ?? 2000)
      windows = await runner.windows()
      if (!windows.length) return { ok: false, why: 'It closed after its first window.' }
    }
    return { ok: false, why: 'It kept opening boxes instead of the game.' }
  } finally {
    await runner.stop()
  }
}

function reasonOrCode(log: string, exit: number): string {
  const line = log.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/fixme:|err:ole|Xlib/.test(l)).pop()
  const text = line ? (line.length > 160 ? `${line.slice(0, 159)}…` : line) : ''
  return text ? `It closed straight away: ${text}` : `It closed straight away (code ${exit}).`
}

// ---------- 4. run ----------

type Tried = { state: 'ready'; program: FoundProgram; dir: string; screenshot?: string } | { state: 'no'; why: string }

/** After files are in place: find the program and start it. */
async function prove(job: InstallJob, dir: string, installer: string | null, say: (t: string) => void): Promise<Tried> {
  const files = await job.runner.files(dir)
  const program = findProgram(files, { hint: job.programHint, names: programNames(job.title, installer), linux: job.platform === 'linux' })
  if (!program) return { state: 'no', why: files.length ? 'There’s no game program among the files.' : 'No files came out.' }
  say(`The game’s program: ${program.path}`)
  const started = await startCheck(job, `${dir}/${program.path}`)
  if (!started.ok) {
    say(`It doesn’t start: ${started.why}`)
    return { state: 'no', why: `The game doesn’t start. ${started.why}` }
  }
  say('It starts.')
  return { state: 'ready', program, dir, screenshot: started.screenshot }
}

/** Installs a finished download. Never throws for an installer's sake: the outcome says what happened. */
export async function install(job: InstallJob, nested = 0): Promise<InstallOutcome> {
  const { runner } = job
  const log: string[] = []
  const say = (text: string, tier?: Tier) => {
    log.push(text)
    job.onStep?.(text, tier)
  }
  const root = nested ? UNPACKED : 'download'
  const hangAfterMs = job.hangAfterMs ?? 120_000
  const sleep = job.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const found = await survey(job.files, job.sniff, root)
  const installer = pickInstaller(found, { hint: job.installerHint, platform: job.platform })
  let listing: string[] = []
  if (installer?.sniffed.unpack && ['inno', 'nsis'].includes(installer.sniffed.kind)) listing = await runner.list(installer.sniffed.unpack, `${root}/${installer.path}`).catch(() => [])
  const plan = planInstall(installer, { host: runner.host, maxVersion: (t) => runner.supports(t).maxVersion, listing, siblings: found, root })
  if (!installer || !plan.steps.length) return { state: 'failed', reason: plan.notes.at(-1) ?? 'There’s nothing to install in this download.', log }
  say(`${installer.path}: ${plan.format}`)
  for (const n of plan.notes) say(n)

  // The best explanation so far, should nothing work: an installer's own words beat a guess.
  let reason = ''
  const ready = (t: Extract<Tried, { state: 'ready' }>, by: Tier): InstallOutcome => ({ state: 'ready', by, program: t.program.path, dir: t.dir, ...(t.screenshot ? { screenshot: t.screenshot } : {}), log })

  for (const step of plan.steps) {
    say(step.why, step.tier)
    if (step.tier === 'unpack') {
      // A nested installer unpacks beside the archive it came out of, not on top of it.
      const into = nested ? `${UNPACKED}-${nested}` : UNPACKED
      await runner.clear(into)
      let failed = ''
      for (const f of step.files!) {
        const r = await runner.unpack(step.tool!, f, into)
        if (r.exit !== 0 || r.hung) {
          failed = r.hung ? 'Unpacking stopped part-way.' : `It couldn’t be unpacked (${failureReason('archive', r.exit, r.log)})`
          break
        }
      }
      if (failed) {
        say(failed)
        reason ||= failed
        continue
      }
      // An archive (or disc image) that holds an installer: start again from what came out.
      if (installer.sniffed.kind === 'archive' && nested < 1) {
        const inside = await runner.files(into)
        const inner = pickInstaller(await survey(inside, job.sniff, into))
        if (inner && ['inno', 'nsis', 'msi'].includes(inner.sniffed.kind)) {
          say(`Inside is an installer: ${inner.path}`)
          const out = await install({ ...job, files: inside, installerHint: inner.path, onStep: job.onStep }, nested + 1)
          return { ...out, log: [...log, ...out.log] }
        }
      }
      const t = await prove(job, into, installer.path, say)
      if (t.state === 'ready') return ready(t, 'unpack')
      reason ||= t.why
      continue
    }

    if (step.tier === 'silent') {
      await runner.clear(INSTALLED)
      const r = await runner.install(step.command!, { hangAfterMs })
      if (r.hung) {
        say('The installer stopped and waited for an answer nobody could give, so it was stopped.')
        reason ||= 'The installer waits for an answer part-way through.'
        continue
      }
      if (r.exit !== 0) {
        const why = failureReason(plan.kind, r.exit, r.log)
        say(`The installer didn’t finish: ${why}`)
        reason = why
        continue
      }
      const t = await prove(job, r.dir ?? INSTALLED, installer.path, say)
      if (t.state === 'ready') return ready(t, 'silent')
      // It installed without complaint and the game still won't start: clicking through the same
      // installer won't change that.
      return { state: 'failed', reason: t.why, log }
    }

    if (step.tier === 'auto-click') {
      await runner.clear(INSTALLED)
      let done: Awaited<ReturnType<SandboxRunner['install']>> | null = null
      /** How long the same window has sat there with nothing to press and nothing being written. */
      let stuckMs = 0
      const running = runner.install(step.command!, { shown: true, onProgress: () => (stuckMs = 0) }).then((r) => (done = r))
      running.catch(() => {})
      const pollMs = job.pollMs ?? 2000
      let lastSeen = ''
      const pressed = new Map<string, number>()
      let ask: WindowInfo | null = null
      let error = ''
      while (!done) {
        await Promise.race([running.catch(() => {}), sleep(pollMs)])
        if (done) break
        const windows = await runner.windows()
        const seen = windows.map((w) => `${w.title}|${w.text}`).join('\n')
        if (seen !== lastSeen) stuckMs = 0
        lastSeen = seen
        let acted = false
        for (const w of windows) {
          const a = answerWindow(w, plan.kind)
          if (a.do === 'error') {
            error = a.text
            break
          }
          if (a.do === 'ask') {
            // A window with no buttons is the installer working (a progress bar): leave it.
            if (!w.buttons.length && !w.wantsInput) continue
            ask = w
            break
          }
          const key = `${w.title}|${w.text}|${a.button}`
          const times = (pressed.get(key) ?? 0) + 1
          pressed.set(key, times)
          // Pressing the same button on the same page over and over means it isn't moving on.
          if (times > 3) {
            ask = w
            break
          }
          if (await runner.click(w, a.button)) {
            say(`Pressed “${a.button.replace(/&/g, '')}”${w.title ? ` in “${w.title}”` : ''}.`)
            acted = true
            stuckMs = 0
          }
          break
        }
        if (error || ask) break
        if (!acted) stuckMs += pollMs || 1
        if (stuckMs >= hangAfterMs) {
          ask = windows[0] ?? { title: '', class: '', text: '', buttons: [], wantsInput: false }
          break
        }
      }
      if (error) {
        await runner.stop()
        say(`The installer said: ${error}`)
        return { state: 'failed', reason: error, log }
      }
      if (ask) {
        // Left running on purpose: the person finishes it on its screen.
        const about = windowWords(ask)
        say(about ? `The installer wants a person: ${about}` : 'The installer wants a person.')
        return { state: 'needs-you', ...(ask.title ? { waitingOn: ask.title } : {}), why: about || 'The installer stopped at a window Finesse can’t answer for you.', log }
      }
      const r = done!
      if (r.exit !== 0) {
        const why = failureReason(plan.kind, r.exit, r.log)
        say(`The installer didn’t finish: ${why}`)
        return { state: 'failed', reason: reason || why, log }
      }
      const t = await prove(job, r.dir ?? INSTALLED, installer.path, say)
      if (t.state === 'ready') return ready(t, 'auto-click')
      return { state: 'failed', reason: t.why, log }
    }
  }
  return { state: 'failed', reason: reason || 'Finesse couldn’t install this one.', log }
}

/** A person finished the installer on its screen ("Needs you"): find the game and start it. */
export async function finishAfterPerson(job: InstallJob): Promise<InstallOutcome> {
  const log: string[] = []
  const say = (text: string) => {
    log.push(text)
    job.onStep?.(text, 'needs-you')
  }
  await job.runner.stop()
  const t = await prove(job, INSTALLED, job.installerHint ?? null, say)
  if (t.state === 'ready') return { state: 'ready', by: 'needs-you', program: t.program.path, dir: t.dir, ...(t.screenshot ? { screenshot: t.screenshot } : {}), log }
  return { state: 'failed', reason: t.why, log }
}
