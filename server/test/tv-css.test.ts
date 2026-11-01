// The TV sheet (webos/downlevel-css.mjs): the LG CX runs Chromium 68, which drops any rule
// using :where() (Chromium 88+). Those rules are expanded into plain selectors, so the
// focus ring rules and Tailwind's space-y/divide spacing reach the TV.

import assert from 'node:assert/strict'
import { test } from 'node:test'

// A path in a variable: the module is plain JS (no types for the server's typecheck).
const MOD = '../../webos/downlevel-css.mjs'
const load = async () => (await import(MOD)) as { expandWhere: (css: string) => string; downlevelCss: (css: string) => string }

test(':where() lists become plain selectors, in place', async () => {
  const { expandWhere } = await load()
  assert.equal(expandWhere(':where(.space-y-2>:not(:last-child)){margin-top:8px}'), '.space-y-2>:not(:last-child){margin-top:8px}')
  assert.equal(expandWhere('abbr:where([title]){text-decoration:underline}'), 'abbr[title]{text-decoration:underline}')
  assert.equal(
    expandWhere('@media (min-width:40rem){html[x] :where(a:not(.g),button):not([class*="rounded"]):focus{border-radius:8px}}'),
    '@media (min-width:40rem){html[x] a:not(.g):not([class*="rounded"]):focus,html[x] button:not([class*="rounded"]):focus{border-radius:8px}}',
  )
  // Two in one selector: every combination.
  assert.equal(expandWhere(':where(a,b) :where(c,d){x:1}'), 'a c,a d,b c,b d{x:1}')
  // Rules without :where(), and declarations, are left alone.
  assert.equal(expandWhere('.a{background:url(x)}.b:focus{outline:0}'), '.a{background:url(x)}.b:focus{outline:0}')
})

test('the whole TV sheet: no :where() left, the focus corners never land on rounded controls', async () => {
  const { downlevelCss } = await load()
  const src = `@layer base{:where(a,button):not([class*="rounded"]):focus-visible{border-radius:8px}}
@layer utilities{.rounded-full{border-radius:9999px}:where(.space-y-4>:not(:last-child)){margin-block-end:1rem}}`
  const out = downlevelCss(src)
  assert.doesNotMatch(out, /:where\(/)
  assert.match(out, /a:not\(\[class\*=rounded\]\):focus,button:not\(\[class\*=rounded\]\):focus\{border-radius:8px\}/)
  assert.match(out, /\.space-y-4>:not\(:last-child\)\{margin-bottom:1rem\}/)
})
