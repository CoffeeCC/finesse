import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// In production the Radarr/Sonarr request proxy is provided by the app's nginx
// (see nginx.conf). For local `npm run dev` there's no nginx, so optionally proxy
// /finesse/arr/* straight to the *arr APIs when keys are present in .env.local
// (ARR_HOST, RADARR_KEY, SONARR_KEY). These are dev-only and never bundled.
//
// `--mode webos` produces the sideloadable LG TV bundle instead of the web build:
// a single self-contained file off a relative (file://) base. See scripts/build-webos.mjs.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const arrHost = env.ARR_HOST || 'http://192.168.1.121'
  const isWebos = mode === 'webos'

  const proxy: Record<string, object> = {}
  if (env.RADARR_KEY) {
    proxy['/finesse/arr/radarr'] = {
      target: `${arrHost}:30025`,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/arr\/radarr/, '/api/v3'),
      headers: { 'X-Api-Key': env.RADARR_KEY },
    }
  }
  if (env.SONARR_KEY) {
    proxy['/finesse/arr/sonarr'] = {
      target: `${arrHost}:30113`,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/arr\/sonarr/, '/api/v3'),
      headers: { 'X-Api-Key': env.SONARR_KEY },
    }
  }
  if (env.LIDARR_KEY) {
    proxy['/finesse/arr/lidarr'] = {
      target: `${arrHost}:30071`,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/finesse\/arr\/lidarr/, '/api/v1'),
      headers: { 'X-Api-Key': env.LIDARR_KEY },
    }
  }
  if (env.SAB_KEY) {
    proxy['/finesse/arr/sab'] = {
      target: `${arrHost}:30055`,
      changeOrigin: true,
      // SAB wants the key as a query param — append it during the rewrite.
      rewrite: (p: string) => p.replace(/^\/finesse\/arr\/sab\??/, '/api?') + `&apikey=${env.SAB_KEY}`,
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
    plugins: [react(), tailwindcss()],
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
