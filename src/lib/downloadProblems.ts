// A stuck download's reason, in plain words: what happened, and what happens next. The download
// apps' own messages ("One or more episodes expected in this release were not imported or missing
// from the release") are accurate and unreadable; this says the same thing the way a person would,
// and whether Finesse will sort it out by itself (the server's download rescue), or someone has to.
// Pure (no imports; requestStatus.ts uses it too), so server/test/download-problems.test.ts can test it. The patterns mirror
// server/src/downloadRescue.ts: keep the two in step.

export interface ProblemExplained {
  /** What happened, one sentence. */
  what: string
  /** auto: another release fixes it. clear: nothing's wrong, it just isn't needed. person: someone has to act. */
  fix: 'auto' | 'clear' | 'person'
  /** What a person should do, when it's theirs to fix. */
  todo?: string
}

const RULES: { test: RegExp; out: ProblemExplained }[] = [
  { test: /disk (is )?full|not enough (free )?space|no space left|free space/i, out: { what: 'The disk is full, so it can’t be saved.', fix: 'person', todo: 'Free some space (Settings → Server shows what’s using it), and it carries on.' } },
  { test: /permission|access to the path|denied|read-only|is not writable/i, out: { what: 'The library folder can’t be written to.', fix: 'person', todo: 'Whoever runs the server needs to check the folder’s permissions.' } },
  { test: /remote path|path mapping|does not exist|doesn'?t exist|not found on disk|not accessible|root folder/i, out: { what: 'The downloaded files aren’t where the library expects them.', fix: 'person', todo: 'Whoever runs the server needs to check the download folders (Settings → Server → Connected apps).' } },
  { test: /unable to connect|couldn'?t connect|authentication|unauthori[sz]ed|download client (is )?unavailable/i, out: { what: 'The download app isn’t answering.', fix: 'person', todo: 'Check it’s running in Settings → Server → Connected apps.' } },
  { test: /not an upgrade|not a(n)? (quality|custom format) (revision )?upgrade|already (exists|imported|in (your|the) library)|has a better|existing file/i, out: { what: 'The library already has this, as good or better.', fix: 'clear' } },
  { test: /stalled|no connections|no seeds|no peers|dead torrent|not seeded/i, out: { what: 'Nobody is sharing this torrent right now, so nothing is arriving.', fix: 'auto' } },
  { test: /downloading metadata|metadata/i, out: { what: 'The torrent never got started: nobody is sharing it.', fix: 'auto' } },
  { test: /not imported or missing from the release|missing from the release|expected in this release/i, out: { what: 'It downloaded, but some of the episodes it promised weren’t in it.', fix: 'auto' } },
  { test: /sample/i, out: { what: 'It turned out to be a short sample, not the whole thing.', fix: 'auto' } },
  { test: /no files found|no (video|audio) files|not a valid|unable to parse|couldn'?t be parsed|unknown (movie|series|episode|artist|album)/i, out: { what: 'It downloaded, but it isn’t what it said it was.', fix: 'auto' } },
  { test: /password|encrypted|rar|unpack|extract|corrupt|crc|par2|repair|damaged|incomplete/i, out: { what: 'The download was damaged or locked and couldn’t be opened.', fix: 'auto' } },
  { test: /aborted|cannot be completed|failed|missing articles|too many articles|dmca|removed/i, out: { what: 'The download failed part-way: pieces of it are gone from where it was coming from.', fix: 'auto' } },
  { test: /matched to (series|movie) by id|manual import|interaction required|unable to determine/i, out: { what: 'It downloaded, but the library can’t tell for sure what it is.', fix: 'auto' } },
]

/** Explains an app's own reason for a stuck download. */
export function explainProblem(reason: string | undefined, finished = false): ProblemExplained {
  const r = (reason ?? '').trim()
  for (const rule of RULES) if (rule.test.test(r)) return rule.out
  return finished ? { what: 'It downloaded, but couldn’t be added to the library.', fix: 'auto' } : { what: 'The download has stopped moving.', fix: 'auto' }
}

/** "about 25 min", "about 3 h", "under a minute": how long until a time (ms from now). */
export function roughly(ms: number): string {
  if (!(ms > 0)) return 'any moment'
  const min = ms / 60000
  if (min < 1) return 'under a minute'
  if (min < 55) return `about ${Math.max(1, Math.round(min))} min`
  const h = min / 60
  if (h < 23.5) {
    const whole = Math.floor(h)
    const rest = Math.round((h - whole) * 60 / 15) * 15
    return rest === 0 || whole >= 6 ? `about ${Math.round(h)} h` : rest === 60 ? `about ${whole + 1} h` : `about ${whole} h ${rest} min`
  }
  const d = Math.round(h / 24)
  return d === 1 ? 'about a day' : `about ${d} days`
}

/** 1536 → "1.5 KB"; sizes the way people say them (1 GB = 1000 MB, like the stores and the apps). */
export function bytes(n: number): string {
  if (!(n > 0)) return '0 MB'
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  return `${Math.max(1, Math.round(n / 1e3))} KB`
}

/** Bytes a second → "8.4 MB/s". */
export function speed(bps: number): string {
  if (!(bps > 0)) return ''
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} MB/s`
  return `${Math.max(1, Math.round(bps / 1e3))} KB/s`
}
