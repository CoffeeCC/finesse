// Bundles the Finesse server and its CLI into single dependency-free files
// (server/dist/finesse-server.mjs, server/dist/finesse.mjs) for the image.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'none',
  define: { __FINESSE_VERSION__: JSON.stringify(version) },
  // node:sqlite is built in; keep every node: import external.
  external: ['node:*'],
  banner: { js: '// Finesse server — https://github.com/CoffeeCC/finesse' },
  logLevel: 'info',
}

await build({ ...common, entryPoints: ['server/src/main.ts'], outfile: 'server/dist/finesse-server.mjs' })
await build({ ...common, entryPoints: ['server/cli/finesse.ts'], outfile: 'server/dist/finesse.mjs' })
