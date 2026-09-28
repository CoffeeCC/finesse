import { defineConfig, loadEnv, type Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// dist/version.json: what's deployed. Open tabs poll it to offer "Update ready"
// (lib/appUpdate.ts) and the NAS updater reads it to know what it's serving
// (deploy/invite-service). Dev serves the same shape so nothing 404s.
function versionFile(): Plugin {
  const body = () => JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString() })
  return {
    name: 'finesse-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: body() })
    },
    configureServer(server) {
      server.middlewares.use('/finesse/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(body())
      })
    },
  }
}

// `npm run dev` serves only the app. Point it at a running Finesse server with
// FINESSE_SERVER in .env.local (e.g. FINESSE_SERVER=http://localhost:8080) and
// every server path (discovery, setup/system APIs, /jellyfin, the *arr proxy,
// previews, invites, games) is proxied to it — the easiest way to develop.
//
// Without it, the legacy options proxy /finesse/arr/* straight to the *arr APIs
// when keys are present in .env.local (ARR_HOST, RADARR_KEY, SONARR_KEY, ...).
// These are dev-only and never bundled.
//
// `--mode webos` produces the sideloadable LG TV bundle instead of the web build:
// a single self-contained file off a relative (file://) base. See scripts/build-webos.mjs.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const arrHost = env.ARR_HOST || 'http://localhost'
  const isWebos = mode === 'webos'

  const proxy: Record<string, object> = {}
  if (env.FINESSE_SERVER) {
    const target = env.FINESSE_SERVER.replace(/\/+$/, '')
    proxy['^/finesse/(api|arr|previews|invite-api|games)(/|$)'] = { target, changeOrigin: true }
    proxy['/jellyfin'] = { target, changeOrigin: true, ws: true }
  }
  if (!env.FINESSE_SERVER && env.RADARR_KEY) {
    proxy['/finesse/arr/radarr'] = {
      target: `${arrHost}:30025`,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/arr\/radarr/, '/api/v3'),
      headers: { 'X-Api-Key': env.RADARR_KEY },
    }
  }
  if (!env.FINESSE_SERVER && env.SONARR_KEY) {
    proxy['/finesse/arr/sonarr'] = {
      target: `${arrHost}:30113`,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/arr\/sonarr/, '/api/v3'),
      headers: { 'X-Api-Key': env.SONARR_KEY },
    }
  }
  if (!env.FINESSE_SERVER && env.LIDARR_KEY) {
    proxy['/finesse/arr/lidarr'] = {
      target: `${arrHost}:30071`,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/arr\/lidarr/, '/api/v1'),
      headers: { 'X-Api-Key': env.LIDARR_KEY },
    }
  }
  if (!env.FINESSE_SERVER && env.SAB_KEY) {
    proxy['/finesse/arr/sab'] = {
      target: `${arrHost}:30055`,
      changeOrigin: true,
      // SAB wants the key as a query param — append it during the rewrite.
      rewrite: (p: string) => p.replace(/^\/finesse\/arr\/sab\??/, '/api?') + `&apikey=${env.SAB_KEY}`,
    }
  }

  // Legacy nginx deployments: preview clips and the invite service live on the
  // NAS nginx. Set CONTENT_HOST (e.g. http://nas:30500) to proxy them in dev.
  if (!env.FINESSE_SERVER && env.CONTENT_HOST) {
    proxy['/finesse/previews'] = { target: env.CONTENT_HOST, changeOrigin: true }

    // Invite service (native invites) — prod nginx proxies /invite-api to the
    // host service; in dev, hit the deployed nginx so the admin panel works.
    proxy['/finesse/invite-api'] = {
      target: env.CONTENT_HOST,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/invite-api/, '/invite-api'),
    }
  }

  // Games: proxy the RomM API/assets in dev with the RomM Basic auth injected
  // (prod does this in nginx). ROMM_AUTH = base64 of "user:pass" in .env.local.
  if (!env.FINESSE_SERVER && env.ROMM_AUTH) {
    const rommTarget = env.ROMM_HOST || `${arrHost}:30061`
    proxy['/finesse/games/api'] = {
      target: rommTarget,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/games\/api/, '/api'),
      headers: { Authorization: `Basic ${env.ROMM_AUTH}` },
    }
    proxy['/finesse/games/assets'] = {
      target: rommTarget,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/games\/assets/, '/assets'),
      headers: { Authorization: `Basic ${env.ROMM_AUTH}` },
    }
  }

  // SteamGridDB box-art fallback (prod does this in nginx). SGDB_KEY in .env.local.
  if (!env.FINESSE_SERVER && env.SGDB_KEY) {
    proxy['/finesse/games/sgdb'] = {
      target: 'https://www.steamgriddb.com',
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/games\/sgdb/, '/api/v2'),
      headers: { Authorization: `Bearer ${env.SGDB_KEY}` },
    }
  }

  return {
    // Web build is served under /finesse/ behind the Tailscale Funnel (shares
    // :10000 with Jellyfin). The webOS build runs off file:// so it needs a
    // relative base and inlines everything into one chunk (no dynamic imports).
    base: isWebos ? './' : '/finesse/',
    define: {
      __WEBOS__: JSON.stringify(isWebos),
      __APP_VERSION__: JSON.stringify(pkg.version),
      // webOS 3–5 (Chromium 53–68) predate globalThis (Chrome 71).
      ...(isWebos ? { globalThis: 'window' } : {}),
    },
    plugins: [react(), tailwindcss(), ...(isWebos ? [] : [versionFile()])],
    server: { port: 5173, proxy },
    ...(isWebos
      ? {
          build: {
            outDir: 'dist-webos',
            // LG TVs ship Chromium 53–120 depending on webOS generation. Vite's
            // default (es2020) emits ?? and ?. which choke on webOS 3–6 (≤79).
            target: 'chrome53',
            cssCodeSplit: false,
            assetsInlineLimit: 100_000_000, // inline fonts/images as data URIs
            rollupOptions: {
              output: {
                format: 'iife' as const, // classic script so the OTA bootstrap can document.write it
                inlineDynamicImports: true,
                entryFileNames: 'app.js',
                assetFileNames: 'app.[ext]',
              },
            },
          },
        }
      : {}),
  }
})
