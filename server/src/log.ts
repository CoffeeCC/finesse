// Tiny structured-ish logger: one line per event, with a scope. Secrets are
// never passed in here — callers log names, not values.

type Level = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = ORDER[(process.env.FINESSE_LOG_LEVEL as Level) || 'info'] ?? 20

function write(level: Level, scope: string, msg: string, extra?: unknown) {
  if (ORDER[level] < threshold) return
  const time = new Date().toISOString()
  const tail = extra === undefined ? '' : ' ' + (extra instanceof Error ? extra.stack ?? extra.message : JSON.stringify(extra))
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${tail}`
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => write('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => write('error', scope, msg, extra),
  }
}

export type Logger = ReturnType<typeof logger>
