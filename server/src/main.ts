// Finesse server entry point.

import { createApp, ensureSetupCode, type Plugin } from './app.ts'
import { setupPlugin } from './setup/routes.ts'
import { systemPlugin, type StackRef } from './system/routes.ts'
import { VERSION } from './jellyfin.ts'
import { logger } from './log.ts'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { createSecureContext, type SecureContext } from 'node:tls'
import { tailscaleCert, savedTailscaleCert } from './tailscale.ts'
import { Docker } from './stack/docker.ts'
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

  // HTTPS too: Finesse's certificate (signed by its own authority) for its addresses, and Tailscale's
  // real one for its Tailscale name when there is one. Both renewed twice a day, without a restart.
  let secure: HttpsServer | null = null
  const httpsPort = Number(process.env.FINESSE_HTTPS_PORT || 0)
  const configDir = deps.settings.paths.configDir
  let own = httpsPort > 0 || Number(process.env.FINESSE_STREAM_PORT || 0) > 0 ? finesseCert(configDir, certNames(s.publicUrl)) : null
  let ts = savedTailscaleCert(configDir)
  let tsCtx: SecureContext | null = ts ? createSecureContext({ key: ts.key, cert: ts.cert }) : null
  const tlsOptions = () => ({
    ...own!,
    SNICallback: (name: string, cb: (err: Error | null, ctx?: SecureContext) => void) => cb(null, ts && tsCtx && name.toLowerCase() === ts.name ? tsCtx : undefined),
  })
  if (httpsPort > 0) {
    try {
      secure = createHttpsServer(tlsOptions())
      for (const ev of ['request', 'upgrade'] as const) for (const fn of server.listeners(ev)) secure.on(ev, fn as (...a: unknown[]) => void)
      secure.keepAliveTimeout = server.keepAliveTimeout
      await new Promise<void>((resolve, reject) => secure!.once('error', reject).listen(httpsPort, host, resolve))
      log.info(`and on https://${host}:${httpsPort} (Finesse's own certificate${ts ? `, and Tailscale's for ${ts.name}` : ''})`)
    } catch (e) {
      log.error(`HTTPS on port ${httpsPort} didn't start`, e)
      secure = null
    }
  }

  // Wolf games in Finesse's page: Moonlight-Web, on a port of its own (it needs a whole address).
  let stream: HttpsServer | null = null
  const streamPort = Number(process.env.FINESSE_STREAM_PORT || 0)
  if (streamPort > 0 && deps.browserStream) {
    const bs = deps.browserStream
    try {
      stream = createHttpsServer(tlsOptions(), (req, res) => bs.handle(req, res))
      stream.on('upgrade', (req, socket, head) => bs.upgrade(req, socket, head))
      await new Promise<void>((resolve, reject) => stream!.once('error', reject).listen(streamPort, host, resolve))
      log.info(`games in the page: https://${host}:${streamPort}`)
    } catch (e) {
      log.error(`The game stream port ${streamPort} didn't start`, e)
      stream = null
    }
  }

  // Certificates: Tailscale's fetched (or renewed) now and twice a day; Finesse's own renewed when near its end.
  const refreshTls = async () => {
    if (!secure && !stream) return
    try {
      own = finesseCert(configDir, certNames(deps.settings.get().publicUrl))
      const next = await tailscaleCert(new Docker(), configDir)
      if (next && (next.cert !== ts?.cert || next.name !== ts?.name)) {
        ts = next
        tsCtx = createSecureContext({ key: next.key, cert: next.cert })
      }
      for (const srv of [secure, stream]) srv?.setSecureContext(own)
    } catch (e) {
      log.warn(`certificates: ${(e as Error).message}`)
    }
  }
  setTimeout(() => void refreshTls(), 5000).unref()
  setInterval(() => void refreshTls(), 12 * 3600_000).unref()

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
    stream?.close()
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
