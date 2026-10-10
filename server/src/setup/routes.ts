// /api/setup — the wizard's backend and the headless (AI agent) entry point.
// Before setup: every call needs the one-time setup code. After: a Jellyfin
// administrator (re-running setup repairs or changes the stack).

import type { IncomingMessage } from 'node:http'
import type { SettingsStore } from '../config.ts'
import type { AppDeps, Plugin } from '../app.ts'
import { checkSetupCode, requireSetupCode } from '../auth.ts'
import { ApiError, readJson, sendJson } from '../http/core.ts'
import schema from '../../../setup.schema.json' with { type: 'json' }
import { CATALOG } from '../stack/catalog.ts'
import { SetupRunner, stackBase } from './apply.ts'
import { checkIndexer, checkSystem, checkUsenet, checkVpn } from './checks.ts'
import { fillSecrets, KEEP, maskSecrets, validateSetup, type SetupDoc, VPN_PROVIDERS, type VpnDoc } from './doc.ts'
import type { IndexerInput, UsenetServer } from '../stack/wire.ts'

/** Well-known Usenet indexers (suggestions only — you still need your own account). */
export const INDEXER_SUGGESTIONS = [
  { name: 'NZBgeek', url: 'https://api.nzbgeek.info' },
  { name: 'NZBPlanet', url: 'https://api.nzbplanet.net' },
  { name: 'DrunkenSlug', url: 'https://api.drunkenslug.com' },
  { name: 'NZBFinder', url: 'https://nzbfinder.ws' },
  { name: 'altHUB', url: 'https://api.althub.co.za' },
  { name: 'DOGnzb', url: 'https://api.dognzb.cr' },
]

export function setupPlugin(runnerRef: { runner?: SetupRunner } = {}): Plugin {
  return (deps: AppDeps) => {
    const { router, settings, auth } = deps
    const runner = new SetupRunner(settings)
    runnerRef.runner = runner
    // Finesse restarted in the middle of a first setup: say so, so the wizard
    // offers to run it again rather than waiting forever.
    if (settings.get().setup.state === 'applying') {
      settings.update((s) => {
        s.setup.state = 'error'
        s.setup.lastError = 'Setup was interrupted (Finesse restarted). Run it again — finished steps are skipped.'
      })
    }

    /** The last applied setup, when the server is finished (for filling in masked secrets). */
    const storedDoc = () => { const s = settings.get(); return s.setup.state === 'ready' ? (s.setup.lastDoc as SetupDoc | undefined) : undefined }
    const guard = async (req: IncomingMessage, opts: { status?: boolean } = {}) => {
      const s = settings.get()
      if (s.setup.state === 'ready') {
        // The wizard finishing up can still read status with its code for a while.
        if (opts.status && runner.finishedAt && Date.now() - runner.finishedAt < 30 * 60 * 1000 && req.headers['x-finesse-setup-code']) {
          try {
            return requireSetupCodeAllowReady(settings, req)
          } catch {
            /* fall through to admin */
          }
        }
        await auth.requireAdmin(req)
        return
      }
      requireSetupCode(settings, req)
    }

    // The setup document's JSON Schema (public: it holds no secrets).
    router.get('/api/setup/schema', ({ res }) => sendJson(res, 200, schema))

    router.post('/api/setup/code', async ({ req, res }) => {
      await guard(req)
      sendJson(res, 200, { ok: true })
    })

    router.get('/api/setup/info', async ({ req, res }) => {
      await guard(req)
      const s = settings.get()
      const base = stackBase()
      sendJson(res, 200, {
        state: s.setup.state,
        mode: s.mode,
        defaults: {
          timezone: process.env.TZ || 'Etc/UTC', root: base.hostRoot, data: base.hostData, puid: base.puid, pgid: base.pgid, gpu: base.gpu,
          // What people see on this machine (the Windows installer says "E:\Finesse"; data is Docker's own view), and its address at home.
          dataLabel: process.env.FINESSE_DATA_LABEL || null, lanHost: process.env.FINESSE_LAN_HOST || null,
        },
        vpnProviders: VPN_PROVIDERS,
        indexerSuggestions: INDEXER_SUGGESTIONS,
        catalog: Object.values(CATALOG).map((d) => ({ id: d.id, name: d.name, role: d.role, image: d.image })),
        lastError: s.setup.lastError ?? null,
        stack: s.stack ? { services: s.stack.services, quality: s.stack.quality, vpn: s.stack.vpn ? { provider: s.stack.vpn.provider, type: s.stack.vpn.type, countries: s.stack.vpn.countries } : null } : null,
      })
    })

    router.post('/api/setup/check/system', async ({ req, res }) => {
      await guard(req)
      const base = stackBase()
      // Join the stack network now, so later checks can reach apps on it.
      await runner.orch.prepareNetwork({ ...base, timezone: 'Etc/UTC', exposeJellyfin: false, jellyfinPort: 8096 }).catch(() => {})
      sendJson(res, 200, await checkSystem(runner.orch.docker, { root: base.hostRoot, data: base.hostData }, () => runner.orch.hostDevices(), (p) => runner.orch.hostPortFree(p)))
    })

    router.post('/api/setup/check/usenet', async ({ req, res }) => {
      await guard(req)
      const s = (await readJson<UsenetServer>(req)) as UsenetServer
      if (s.password === KEEP) s.password = String(storedDoc()?.downloads?.usenet?.servers?.find((x) => x.host === s.host)?.password ?? '')
      if (!s.host || !s.port) throw new ApiError(400, 'host and port are required')
      sendJson(res, 200, await checkUsenet({ ...s, name: s.name || 'test', connections: s.connections || 1, port: Number(s.port), ssl: s.ssl !== false }))
    })

    router.post('/api/setup/check/indexer', async ({ req, res }) => {
      await guard(req)
      const ix = await readJson<IndexerInput>(req)
      if (ix.apiKey === KEEP) ix.apiKey = storedDoc()?.downloads?.indexers?.find((x) => x.url === ix.url)?.apiKey
      try {
        new URL(ix.url)
      } catch {
        throw new ApiError(400, 'A valid url is required')
      }
      sendJson(res, 200, await checkIndexer({ name: ix.name || new URL(ix.url).host, kind: ix.kind === 'torznab' ? 'torznab' : 'newznab', url: ix.url, apiKey: ix.apiKey }))
    })

    router.post('/api/setup/check/vpn', async ({ req, res }) => {
      await guard(req)
      const vpn = fillSecrets(await readJson<VpnDoc>(req), storedDoc()?.downloads?.torrents?.vpn) as VpnDoc
      const { problems } = validateSetup({ admin: { username: 'check', password: 'placeholder' }, downloads: { torrents: { vpn } } })
      if (problems.length) return sendJson(res, 200, { ok: false, message: problems[0]!.message, problems })
      const base = stackBase()
      await runner.orch.prepareNetwork({ ...base, timezone: 'Etc/UTC', exposeJellyfin: false, jellyfinPort: 8096 })
      sendJson(res, 200, await checkVpn(runner.orch.docker, vpn, { hostRoot: base.hostRoot, network: base.network, timezone: process.env.TZ || 'Etc/UTC', hostDevices: await runner.orch.hostDevices() }))
    })

    router.post('/api/setup/validate', async ({ req, res }) => {
      await guard(req)
      let body = await readJson(req, 1 << 20)
      if (storedDoc()) body = fillSecrets(body, storedDoc()) as typeof body
      const { problems } = validateSetup(body)
      sendJson(res, 200, { ok: problems.length === 0, problems })
    })

    // A finished server, changed from Settings: the last setup, secrets masked (admins only, via guard).
    router.get('/api/setup/current', async ({ req, res }) => {
      await guard(req)
      const s = settings.get()
      sendJson(res, 200, { doc: s.setup.state === 'ready' && s.setup.lastDoc ? maskSecrets(s.setup.lastDoc) : null })
    })

    router.post('/api/setup/apply', async ({ req, res }) => {
      await guard(req)
      let body = await readJson(req, 1 << 20)
      const stored = settings.get().setup.lastDoc
      if (settings.get().setup.state === 'ready' && stored) body = fillSecrets(body, stored) as typeof body
      const { doc, problems } = validateSetup(body)
      if (!doc) throw new ApiError(422, 'The setup has problems', problems)
      if (runner.status.state === 'running') throw new ApiError(409, 'Setup is already running')
      sendJson(res, 202, runner.start(doc))
    })

    router.get('/api/setup/status', async ({ req, res }) => {
      await guard(req, { status: true })
      sendJson(res, 200, { ...runner.status, setup: settings.get().setup.state })
    })
  }
}


/** Same check as requireSetupCode, but valid for a short while after setup completes. */
function requireSetupCodeAllowReady(settings: SettingsStore, req: IncomingMessage) {
  const s = settings.get().setup
  if (!s.codeHash || !s.codeSalt) throw new ApiError(401, 'Setup code expired')
  checkSetupCode(s.codeSalt, s.codeHash, req)
}
