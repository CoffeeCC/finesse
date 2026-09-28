// Finesse server entry point.

import { createApp, ensureSetupCode, type Plugin } from './app.ts'
import { setupPlugin } from './setup/routes.ts'
import { systemPlugin, type StackRef } from './system/routes.ts'
import { VERSION } from './jellyfin.ts'
import { logger } from './log.ts'

const log = logger('finesse')

export function defaultPlugins(ref: StackRef = {}): Plugin[] {
  return [setupPlugin(ref), systemPlugin(ref)]
}

export async function main(plugins: Plugin[] = defaultPlugins()) {
  const { server, deps } = createApp({ plugins })
  const s = deps.settings.get()
  const port = Number(process.env.PORT || 8080)
  const host = process.env.HOST || '0.0.0.0'

  await new Promise<void>((resolve) => server.listen(port, host, resolve))
  log.info(`Finesse ${VERSION} listening on http://${host}:${port} (mode ${s.mode}, web ${deps.web.current().version ?? 'none'})`)

  const code = ensureSetupCode(deps.settings)
  if (code) {
    const line = '─'.repeat(52)
    process.stdout.write(
      // The port here is the one inside the container; people know the one they published (e.g. 30500 on TrueNAS).
      `\n${line}\n  Finesse isn't set up yet.\n  Open http://<this-machine>:<its port>/finesse/setup\n  (the port you gave Finesse, ${port} unless you changed it)\n  and enter the setup code:\n\n      ${code}\n\n  (Show it again any time: docker exec finesse finesse setup-code)\n${line}\n\n`,
    )
  }

  const stop = (sig: string) => {
    log.info(`${sig} — shutting down`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
  return { server, deps }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('finesse-server.mjs')) {
  main().catch((e) => {
    log.error('failed to start', e)
    process.exit(1)
  })
}
