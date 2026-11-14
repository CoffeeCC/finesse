// The answer sheet: what Finesse says to an installer so nobody has to. Two halves, both pure.
//
//   - Switches: each installer family's own way of running with no questions.
//   - Windows: what to do with a window that turns up anyway (during a clicked-through install,
//     or when the game is first started): click the button that moves it on, stop on an error
//     and keep its words, or hand it to a person when it wants something typed or chosen.
//
// These are the installer makers' documented switches and the labels wizards use everywhere;
// nothing here is about any one game or any one packager.

import type { InstallerKind, Sniffed } from '../installerSniff.ts'
import type { WindowInfo } from './types.ts'

export interface SilentChoices {
  /** Inno Setup: component and task names to turn on (read from the installer where it lists them). */
  components?: string[]
  tasks?: string[]
}

/**
 * The command for a run with no questions. <dir> and <log> are filled in by whoever runs it.
 * On Linux (Wine) Inno installs for all users: a per-user install has no Programs folder there.
 * On Windows it installs for the current user, which needs no administrator.
 */
export function silentCommand(file: string, s: Sniffed, host: 'linux' | 'windows', choices: SilentChoices = {}): string[] | null {
  if (s.kind === 'inno')
    return [
      file,
      '/VERYSILENT',
      '/SUPPRESSMSGBOXES',
      '/NORESTART',
      '/SP-',
      host === 'linux' ? '/ALLUSERS' : '/CURRENTUSER',
      '/DIR=<dir>',
      '/LOG=<log>',
      ...(choices.components?.length ? [`/COMPONENTS=${choices.components.join(',')}`] : []),
      ...(choices.tasks?.length ? [`/TASKS=${choices.tasks.join(',')}`] : []),
    ]
  // /D= has no quotes and must come last.
  if (s.kind === 'nsis') return [file, '/S', '/D=<dir>']
  if (s.kind === 'msi' && s.format.startsWith('WiX')) return [file, '/quiet', '/norestart', 'InstallFolder=<dir>', '/log', '<log>']
  if (s.kind === 'msi') return ['msiexec', '/i', file, '/qn', '/norestart', 'INSTALLDIR=<dir>', 'TARGETDIR=<dir>', '/l*', '<log>']
  // A Makeself script unpacks itself without running what's inside.
  if (s.kind === 'linux' && s.format.includes('Makeself')) return [file, '--noexec', '--target', '<dir>']
  return null
}

/** The command for a run with its windows, to be clicked through. */
export function shownCommand(file: string, s: Sniffed): string[] {
  if (s.kind === 'inno') return [file, '/NORESTART', '/SP-', '/DIR=<dir>', '/LOG=<log>']
  if (s.kind === 'nsis') return [file, '/D=<dir>']
  if (s.kind === 'msi' && !s.format.startsWith('WiX')) return ['msiexec', '/i', file, '/norestart', 'INSTALLDIR=<dir>', 'TARGETDIR=<dir>', '/l*', '<log>']
  return [file]
}

// ---------- windows ----------

export type WindowAnswer =
  /** Click this button (its label as the window gives it). */
  | { do: 'click'; button: string }
  /** It's telling us something went wrong. */
  | { do: 'error'; text: string }
  /** It wants a person: something typed, chosen, or a question we won't answer for them. */
  | { do: 'ask'; about: string }

const label = (b: string) => b.replace(/&/g, '').replace(/[<>.…]+/g, '').trim().toLowerCase()

/** Buttons that move a wizard on, best first. */
const FORWARD = ['install', 'next', 'i agree', 'i accept', 'accept', 'agree', 'continue', 'yes', 'ok', 'finish', 'done', 'close', 'extract', 'unpack', 'start']
/** Buttons never pressed for anyone. */
const NEVER = /^(cancel|no|back|abort|browse|quit|exit|uninstall|remove|repair|retry|ignore|help|restart now|reboot)\b/
const WRONG = /\b(error|failed|failure|cannot|can(?:'|’)t|could(?: not|n(?:'|’)t)|unable|not found|missing|corrupt|invalid|crash|exception|fatal|not enough|insufficient|access (?:is )?denied|has stopped working|is not supported|requires)\b/i
/** A restart is never done from a window. */
const RESTART = /\b(restart|reboot)\b.*\b(computer|now|windows|system)\b/i

/** A window's words in one line, for a person. */
export function windowWords(w: WindowInfo): string {
  const text = w.text.replace(/\s+/g, ' ').trim()
  const both = text && w.title && !text.toLowerCase().includes(w.title.toLowerCase()) ? `${w.title}: ${text}` : text || w.title
  return both.length > 240 ? `${both.slice(0, 239)}…` : both
}

export function answerWindow(w: WindowInfo, kind?: InstallerKind): WindowAnswer {
  const buttons = w.buttons.map((b) => ({ raw: b, l: label(b) })).filter((b) => b.l)
  const pressable = buttons.filter((b) => !NEVER.test(b.l))
  const forward = FORWARD.map((f) => pressable.find((b) => b.l === f || b.l.startsWith(`${f} `))).find(Boolean)
  const words = windowWords(w)

  // A box with only a way out, saying something went wrong: that's the reason it didn't work.
  const onlyOut = pressable.every((b) => ['ok', 'close'].includes(b.l))
  if (WRONG.test(`${w.title} ${w.text}`) && onlyOut && !w.wantsInput) return { do: 'error', text: words }
  if (RESTART.test(w.text)) {
    const later = buttons.find((b) => /^(no|later|restart later|not now)\b/.test(b.l))
    return later ? { do: 'click', button: later.raw } : { do: 'ask', about: words }
  }
  // Something to type or choose. An install folder page is the exception: the folder was
  // already given on the command line, so Next is right.
  if (w.wantsInput) {
    const folderPage = kind !== undefined && /\b(destination|install(?:ation)? (?:folder|location|directory)|where should .* be installed)\b/i.test(w.text)
    if (!(folderPage && forward)) return { do: 'ask', about: words }
  }
  if (forward) return { do: 'click', button: forward.raw }
  return { do: 'ask', about: words }
}

// ---------- why it failed ----------

const INNO_EXIT: Record<number, string> = {
  1: 'The installer wouldn’t start.',
  2: 'The installer was cancelled before it began.',
  3: 'The installer hit an error while getting ready.',
  4: 'The installer hit an error while copying the game.',
  5: 'The installer was cancelled part-way.',
  7: 'The installer decided it couldn’t go ahead.',
  8: 'The installer wants the computer restarted first.',
}
const MSI_EXIT: Record<number, string> = {
  1602: 'The installer was cancelled.',
  1603: 'The installer hit an error.',
  1618: 'Another installer was already running.',
  1619: 'The installer package couldn’t be opened.',
  1633: 'This installer isn’t for this kind of computer.',
  1638: 'Another version is already installed.',
}

const NOISE = /fixme:|err:ole|err:winediag|Xlib|^\s*$|^-+$/
const BAD = /\b(error|failed|fail|cannot|can(?:'|’)t|could(?: not|n(?:'|’)t)|unable|abort|refus|not found|missing|corrupt|denied|not enough|insufficient)/i

/** The installer's own explanation: the last line of its log that says what went wrong. */
export function reasonFromLog(log: string): string | undefined {
  const lines = log
    .split(/\r?\n/)
    // Inno's log starts each line with a date and time; MSI's with "MSI (s) (..) [time]:".
    .map((l) => l.replace(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+/, '').replace(/^MSI \([a-z]\) \([^)]*\) \[[^\]]*\]:\s*/i, '').trim())
    .filter((l) => !NOISE.test(l))
  const said = lines.reverse().find((l) => BAD.test(l) && !/^(exit|exiting|setup exit code|deinitializesetup|log closed)/i.test(l))
  if (!said) return undefined
  const text = said.replace(/^(message box \([^)]*\):|msgbox:|error:)\s*/i, '').trim()
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}

/** Why a run that ended badly ended badly, in words: the log's, else what the exit code means. */
export function failureReason(kind: InstallerKind, exit: number | null, log: string): string {
  const said = reasonFromLog(log)
  if (said) return /[.!?…]$/.test(said) ? said : `${said}.`
  if (exit !== null && kind === 'inno' && INNO_EXIT[exit]) return INNO_EXIT[exit]
  if (exit !== null && kind === 'msi' && MSI_EXIT[exit]) return MSI_EXIT[exit]
  return exit === null ? 'The installer was stopped.' : `The installer stopped without saying why (code ${exit}).`
}
