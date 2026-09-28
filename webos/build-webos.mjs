// Builds the sideloadable webOS package.
//
//   1. vite build --mode webos  -> dist-webos/ (one JS chunk + one CSS file)
//   2. read app.js + app.css as strings (fonts/images already inlined as data URIs)
//   3. stage webos/staging/: appinfo.json + icons + bootstrap + app.js/app.css
//      (baked.js only carries the version — boot.js loads the files on disk)
//   4. ares-package            -> webos/release/*.ipk        (needs LG CLI)
//   5. emit webos/release/finesse-webos-<v>.json as the OTA asset
//
// The app ships as { version, css, js } (NOT a single HTML file): the launch
// bootstrap injects css+js as live DOM elements, which reliably execute. See
// webos/bootstrap/boot.js and src/lib/webosUpdate.ts.
//
// Run via: npm run package:webos
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { downlevelCss } from './downlevel-css.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const r = (p) => root + p
const pkg = JSON.parse(readFileSync(r('package.json'), 'utf8'))
const version = pkg.version

console.log(`\n▶ Building Finesse webOS bundle v${version}\n`)

// 1. Vite build (single iife chunk, relative base — see vite.config.ts mode webos)
execSync('npx vite build --mode webos', { cwd: root, stdio: 'inherit' })

// 2. Read the built bundle as strings
const js = readFileSync(r('/dist-webos/app.js'), 'utf8')
const rawCss = readFileSync(r('/dist-webos/app.css'), 'utf8')
// Belt-and-suspenders: older LG Chromium may still ship a stray globalThis reference.
const jsSafe = js.replace(/\bglobalThis\b/g, 'window')
// Tailwind v4 CSS is unparseable on TV Chromium (@layer drops the ENTIRE sheet);
// down-level it for the TV. See webos/downlevel-css.mjs for the full story.
const css = downlevelCss(rawCss)
console.log(`  css down-leveled for TV Chromium: ${(rawCss.length / 1024).toFixed(0)} kB → ${(css.length / 1024).toFixed(0)} kB`)
const bundle = { version, css, js: jsSafe }
console.log(`  bundle: ${(jsSafe.length / 1024 / 1024).toFixed(2)} MB js + ${(css.length / 1024).toFixed(0)} kB css`)

// 3. Stage the .ipk contents
const staging = r('/webos/staging')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
cpSync(r('/webos/bootstrap'), staging, { recursive: true })

const appinfo = JSON.parse(readFileSync(r('/webos/bootstrap/appinfo.json'), 'utf8'))
appinfo.version = version // appinfo version must track package.json
writeFileSync(staging + '/appinfo.json', JSON.stringify(appinfo, null, 2))

// Ship the bundle as real files (webOS rejects ~1 MB inline <script> injection).
writeFileSync(staging + '/app.js', jsSafe)
writeFileSync(staging + '/app.css', css)
// baked.js = version metadata only (OTA full bundle lives in IndexedDB / release json)
writeFileSync(staging + '/baked.js', 'window.__BAKED__=' + JSON.stringify({ version }) + ';')

// 4. + 5. release outputs
const release = r('/webos/release')
mkdirSync(release, { recursive: true })
writeFileSync(`${release}/finesse-webos-${version}.json`, JSON.stringify(bundle))
console.log(`\n✔ OTA asset: webos/release/finesse-webos-${version}.json`)

try {
  execSync(`ares-package "${staging}" -o "${release}"`, { cwd: root, stdio: 'inherit' })
  console.log(`\n✔ Package: webos/release/com.finesse.tv_${version}_all.ipk\n`)
} catch {
  console.log(
    '\n⚠ ares-package not found (LG webOS CLI). Staging is ready at webos/staging.\n' +
      '  Install the CLI with:  npm i -g @webos-tools/cli\n' +
      '  Then run:              ares-package webos/staging -o webos/release\n',
  )
}
