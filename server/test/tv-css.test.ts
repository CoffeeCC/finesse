// The TV sheet (webos/downlevel-css.mjs): the LG CX runs Chromium 68, which drops any rule
// using :where() (Chromium 88+). Those rules are expanded into plain selectors, so the
// focus ring rules and Tailwind's space-y/divide spacing reach the TV. Also: aspect-ratio,
// flex gap and group-variant fallbacks.

import assert from 'node:assert/strict'
import { test } from 'node:test'

// A path in a variable: the module is plain JS (no types for the server's typecheck).
const MOD = '../../webos/downlevel-css.mjs'
const load = async () => (await import(MOD)) as { expandWhere: (css: string) => string; downlevelCss: (css: string) => string; expandGroupStates: (css: string) => string }

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
  assert.match(out, /\.space-y-4>:not\(:last-child\):not\(\[class\*=mb-\]\):not\(\[class\*=my-\]\)\{margin-bottom:1rem\}/)
})

test('aspect-[w/h] boxes get a padding fallback, whatever the ratio', async () => {
  const { downlevelCss } = await load()
  const out = downlevelCss('@layer utilities{.aspect-\\[3\\/4\\]{aspect-ratio:3/4}.aspect-\\[2\\/3\\]{aspect-ratio:2/3}}')
  assert.match(out, /\.aspect-\\\[3\\\/4\\\]:before\{content:"";padding-top:133\.333%;display:block\}/)
  assert.match(out, /\.aspect-\\\[2\\\/3\\\]:before\{content:"";padding-top:150%;display:block\}/)
  assert.match(out, /\.aspect-\\\[3\\\/4\\\]>img,\.aspect-\\\[3\\\/4\\\]>\.w-full\{[^}]*position:absolute/)
})

test('gap-y-* spaces the lines of a wrapping flex row, and yields to an own top margin', async () => {
  const { downlevelCss } = await load()
  const out = downlevelCss('@layer utilities{.gap-y-2{row-gap:calc(var(--spacing) * 2)}}')
  assert.match(out, /\.flex-wrap\.gap-y-2:not\(\[class\*=mt-\]\):not\(\[class\*=my-\]\)\{margin-top:calc\(calc\(var\(--spacing\) \* 2\) \* -1\)\}/)
  assert.match(out, /\.flex-wrap\.gap-y-2>:not\(\[class\*=mt-\]\):not\(\[class\*=my-\]\)\{margin-top:calc\(var\(--spacing\) \* 2\)\}/)
  // Column stacks keep their sibling fallback.
  assert.match(out, /\.flex-col\.gap-y-2>\*\+\*/)
})

test('group-open: survives as [open], without the states the TV can’t parse', async () => {
  const { downlevelCss, expandGroupStates } = await load()
  assert.equal(
    expandGroupStates('.group-open\\:rotate-180:is(:where(.group):is([open],:popover-open,:open) *){rotate:180deg}'),
    '.group[open] .group-open\\:rotate-180{rotate:180deg}',
  )
  // Nothing the TV knows: left alone.
  assert.equal(expandGroupStates('.x:is(:where(.group):is(:open) *){a:b}'), '.x:is(:where(.group):is(:open) *){a:b}')
  const out = downlevelCss('@layer utilities{.group-open\\:rotate-180:is(:where(.group):is([open],:popover-open,:open) *){rotate:180deg}}')
  assert.match(out, /(^|\})\.group\[open\] \.group-open\\:rotate-180\{--tw-rotate:180deg;transform:/)
  assert.doesNotMatch(out, /popover-open/)
})

test('space-y-* no longer overrides a child’s own top or bottom margin', async () => {
  const { downlevelCss } = await load()
  const out = downlevelCss(
    '@layer utilities{:where(.space-y-4>:not(:last-child)){--tw-space-y-reverse:0;margin-block-start:calc(1rem * var(--tw-space-y-reverse));margin-block-end:calc(1rem * calc(1 - var(--tw-space-y-reverse)))}' +
      '@media (min-width:40rem){:where(.sm\\:space-y-0>:not(:last-child)){--tw-space-y-reverse:0;margin-block-end:calc(0px * calc(1 - var(--tw-space-y-reverse)))}}}',
  )
  assert.match(out, /\.space-y-4>:not\(:last-child\):not\(\[class\*=mt-\]\):not\(\[class\*=my-\]\)\{margin-top:/)
  assert.match(out, /\.space-y-4>:not\(:last-child\):not\(\[class\*=mb-\]\):not\(\[class\*=my-\]\)\{margin-bottom:/)
  assert.match(out, /@media \(min-width:40rem\)\{\.sm\\:space-y-0>:not\(:last-child\):not\(\[class\*=mb-\]\):not\(\[class\*=my-\]\)\{margin-bottom:/)
  // No unqualified space-y rule is left to beat a child's mb-*.
  assert.doesNotMatch(out, /space-y-4>:not\(:last-child\)\{/)
})
