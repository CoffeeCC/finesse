// Finesse server entry point.

import { createApp, ensureSetupCode, type Plugin } from './app.ts'
import { setupPlugin } from './setup/routes.ts'
import { systemPlugin, type StackRef } from './system/routes.ts'
import { VERSION } from './jellyfin.ts'
import { logger } from './log.ts'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { certNames, finesseCert } from './tls.ts'
import { isNative } from './stack/hosts.ts'
import { NativeHost } from './stack/native.ts'

const log = logger('finesse')

export function defaultPlugins(ref: StackRef = {}): Plugin[] {
  return [setupPlugin(ref), systemPlugin(ref)]
}

export async function main(ref: StackRef = {}, plugins: Plugin[] = defaultPlugins(ref)) {
  const { server, deps } = createApp({ plugins })
  const s = deps.settings.get()
  const port = Number(process.env.PORT || 8080)
  const host = process.env.HOST || '0.0.0.0'

  await new Promise<void>((resolve) => server.listen(port, host, resolve))
  log.info(`Finesse ${VERSION} listening on http://${host}:${port} (mode ${s.mode}, web ${deps.web.current().version ?? 'none'})`)

  // HTTPS too, with Finesse's own certificate (browser play needs a secure page).
  let secure: HttpsServer | null = null
  const httpsPort = Number(process.env.FINESSE_HTTPS_PORT || 0)
  if (httpsPort > 0) {
    try {
      secure = createHttpsServer(finesseCert(deps.settings.paths.configDir, certNames(s.publicUrl)))
      for (const ev of ['request', 'upgrade'] as const) for (const fn of server.listeners(ev)) secure.on(ev, fn as (...a: unknown[]) => void)
      secure.keepAliveTimeout = server.keepAliveTimeout
      await new Promise<void>((resolve, reject) => secure!.once('error', reject).listen(httpsPort, host, resolve))
      log.info(`and on https://${host}:${httpsPort} (Finesse's own certificate)`)
    } catch (e) {
      log.error(`HTTPS on port ${httpsPort} didn't start`, e)
      secure = null
    }
  }

  const code = ensureSetupCode(deps.settings)
  if (code && isNative()) {
    log.info('Finesse isn’t set up yet — open Finesse from the Start menu to finish setting it up')
  } else if (code) {
    const line = '─'.repeat(52)
    process.stdout.write(
      // The port here is the one inside the container; people know the one they published (e.g. 30500 on TrueNAS).
      `\n${line}\n  Finesse isn't set up yet.\n  Open http://<this-machine>:<its port>/finesse/setup\n  (the port you gave Finesse, ${port} unless you changed it)\n  and enter the setup code:\n\n      ${code}\n\n  (Show it again any time: docker exec finesse finesse setup-code)\n${line}\n\n`,
    )
  }

  let stopping = false
  const stop = (sig: string) => {
    if (stopping) return
    stopping = true
    log.info(`${sig} — shutting down`)
    secure?.close()
    // Windows: the apps are Finesse's own children; they close first, cleanly.
    const host = ref.runner?.orch
    const apps = host instanceof NativeHost ? host.stopAll() : Promise.resolve()
    void apps.finally(() => server.close(() => process.exit(0)))
    setTimeout(() => process.exit(0), host instanceof NativeHost ? 60000 : 5000).unref()
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
  if (isNative()) {
    // The Finesse service asks for a clean stop by closing Finesse's input (Windows has no SIGTERM for it to send).
    process.stdin.on('data', (b) => String(b).includes('stop') && stop('service stop'))
    process.stdin.on('end', () => stop('service stop'))
    process.stdin.resume()
  }
  return { server, deps }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('finesse-server.mjs')) {
  main().catch((e) => {
    log.error('failed to start', e)
    process.exit(1)
  })
}
