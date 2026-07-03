// Down-levels the Tailwind v4 stylesheet for LG TV Chromium (webOS ships 53–108
// depending on generation; none of them speak Tailwind v4's modern CSS).
//
// What breaks on TVs and what we do about it:
//   @layer …{}        Chromium <99 drops the whole block — and Tailwind wraps
//                     EVERYTHING in layers, so the app renders completely
//                     unstyled. → unwrap all layer blocks in place (source
//                     order already matches the cascade we want).
//   @property         Chromium <85 ignores registrations, so composed vars
//                     (--tw-translate-*, shadows, rings…) are undefined and the
//                     properties using them get dropped. Tailwind's own
//                     fallback block is @supports-gated to Safari/Firefox
//                     only. → emit an unconditional universal rule with every
//                     initial-value.
//   oklch(…)          Chromium <111. All 9 uses are inside --color-* variable
//                     values, which no auto-tool rewrites (var values are
//                     opaque). → convert to rgb() ourselves.
//   in oklab          Gradient interpolation hints (Chromium <111) make the
//                     whole gradient invalid at computed-value time. → strip
//                     from --tw-gradient-position values. (color-mix() keeps
//                     its hint — those declarations are @supports-guarded and
//                     Tailwind emits rgba() fallbacks before them.)
//   :focus-visible    Chromium <86 drops the rule — which would make D-pad
//                     focus invisible on the TV, the one place it matters
//                     most. → rewrite to :focus.
//   inset:/logical    Chromium <87. → lightningcss lowers these (and anything
//                     else it knows) with a chrome-53 target, and re-parsing
//                     the whole sheet doubles as validation of our surgery.
//
// Known acceptable degradation on old engines (not fixed): :is()/:where()
// variant selectors (<88) and flex gap (<84) — cosmetic, not structural.
import { transform } from 'lightningcss'

function oklchToRgb(args) {
  // "62.3% .214 259.815" or "62.3% .214 259.815/50%"
  const [color, alphaRaw] = args.split('/')
  const parts = color.trim().split(/\s+/)
  if (parts.length < 3) return null
  const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0])
  const C = parseFloat(parts[1])
  const H = (parseFloat(parts[2]) * Math.PI) / 180
  if ([L, C, H].some(Number.isNaN)) return null
  // OKLCh -> OKLab -> LMS -> linear sRGB (standard Björn Ottosson matrices)
  const a = C * Math.cos(H)
  const b = C * Math.sin(H)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
  const chan = (x) => {
    x = Math.min(1, Math.max(0, x)) // clamp = crude gamut map, fine for theme colors
    const g = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
    return Math.round(g * 255)
  }
  const [r, g, bb] = lin.map(chan)
  let alpha = 1
  if (alphaRaw !== undefined) {
    alpha = alphaRaw.trim().endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw)
    if (Number.isNaN(alpha)) alpha = 1
  }
  return alpha >= 1 ? `rgb(${r},${g},${bb})` : `rgba(${r},${g},${bb},${alpha})`
}

export function downlevelCss(css) {
  // 1. Drop `@layer a, b, c;` ordering statements.
  css = css.replace(/@layer[^{};]*;/g, '')

  // 2. Unwrap every `@layer name { … }` block (balanced-brace scan).
  for (;;) {
    const m = /@layer[^{};]*\{/.exec(css)
    if (!m) break
    const open = m.index + m[0].length - 1
    let depth = 0
    let close = -1
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) { close = i; break }
      }
    }
    if (close === -1) throw new Error('downlevel-css: unbalanced @layer block')
    css = css.slice(0, m.index) + css.slice(open + 1, close) + css.slice(close + 1)
  }

  // 3. @property registrations -> one universal fallback rule, then drop them.
  const fallbacks = []
  css = css.replace(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g, (_, name, body) => {
    const iv = /initial-value:\s*([^;]+)/.exec(body)
    if (iv) fallbacks.push(`${name}:${iv[1].trim()}`)
    return ''
  })
  if (fallbacks.length) {
    css = `*,:before,:after,::backdrop{${fallbacks.join(';')}}` + css
  }

  // 4. oklch() literals (theme variable values) -> rgb().
  css = css.replace(/oklch\(([^)]+)\)/g, (whole, args) => oklchToRgb(args) ?? whole)

  // 5. Gradient interpolation hints break the whole gradient on old engines.
  css = css.replace(/(--tw-gradient-position:[^;}]*?)\s+in\s+oklab/g, '$1')

  // 6. TV remotes drive :focus, not :focus-visible (unparseable there anyway).
  css = css.replace(/:focus-visible/g, ':focus')

  // 7. `inset:` shorthand (Chromium <87) — lightningcss won't split calc()/var()
  //    values, and Tailwind emits `inset:calc(var(--spacing)*0)`. Broken inset
  //    de-positions every overlay (hero scrims, blurhash layers → "doubled
  //    images"). Expand to longhands ourselves.
  css = css.replace(/([{;])inset:([^;}]+)/g, '$1top:$2;right:$2;bottom:$2;left:$2')

  // 8. Tailwind group-variant selectors use :is(:where(.group)…) — unparseable
  //    on Chromium <88, which silently killed the D-pad focus ring on cards.
  //    Rewrite `.group-X\:util:is(:where(.group):state *)` → `.group:state .group-X\:util`.
  //    (Specificity rises slightly; acceptable on the TV-only sheet.)
  css = css.replace(/(\.(?:\\.|[\w-])+):is\(:where\(\.group\)(:[\w-]+) \*\)/g, '.group$2 $1')

  // 9. Flex `gap` does nothing on Chromium <84 (property parses — grid-era —
  //    but flex layout ignores it), which squishes every toolbar/row together.
  //    For each gap utility in the sheet, emit sibling-margin fallbacks scoped
  //    to flex containers (grid containers keep native gap, which works).
  //    Responsive variants are emitted in source order, so later (larger
  //    breakpoint) rules still win; the TV is a fixed 1920×1080 viewport.
  const gapRules = []
  for (const m of css.matchAll(/\.((?:\\.|[\w-])+)\{(gap|column-gap|row-gap):([^};]+)\}/g)) {
    const [, name, prop, value] = m
    if (!/gap/.test(name)) continue
    if (prop === 'gap' || prop === 'column-gap') {
      gapRules.push(`.flex.${name}>*+*,.inline-flex.${name}>*+*{margin-left:${value}}`)
    }
    if (prop === 'gap' || prop === 'row-gap') {
      gapRules.push(`.flex-col.${name}>*+*{margin-left:0;margin-top:${value}}`)
    }
  }
  css += gapRules.join('')

  // 10. aspect-ratio (Chromium <88) — poster/thumb boxes collapse without it,
  //     making every thumbnail its image's natural size. Padding-top boxes +
  //     absolute-fill for the media children restore fixed shapes. Overlay
  //     badges/progress bars carry their own `absolute` classes and are
  //     unaffected by the >img rule.
  const aspects = [
    ['.aspect-\\[2\\/3\\]', '150%'],
    ['.aspect-video', '56.25%'],
    ['.aspect-square', '100%'],
  ]
  for (const [sel, pad] of aspects) {
    if (!css.includes(sel + '{')) continue
    css +=
      `${sel}{position:relative;height:0;padding-top:${pad}}` +
      `${sel}>img,${sel}>.w-full{position:absolute;top:0;left:0;width:100%;height:100%}`
  }

  // 11. Perf: TV SoCs choke on Finesse's ambient effects — the .aurora layers
  //     are three full-screen blur(90px) surfaces with infinite transform
  //     animations, heroes run continuous Ken Burns zooms, and the nav bar
  //     backdrop-blurs everything under it. Kill them all on TV; keep the
  //     translucent tints (cheap) so the look stays close.
  css +=
    '.aurora{display:none!important}' +
    '.kenburns,.slowzoom,.ambient-breathe,.page-enter,.shimmer{animation:none!important}' +
    '.reveal{opacity:1!important;transform:none!important;transition:none!important}' +
    '.tilt{transition:none!important;will-change:auto!important}' +
    '.tilt-glare{display:none!important}' +
    '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' +
    '.blur-3xl{display:none!important}' +
    'html{scroll-behavior:auto!important}' +
    // 12. Ten-foot clarity: desktop hover/focus cues are far too subtle on a TV.
    //     Bold accent outline for BOTH input modes — D-pad focus and the Magic
    //     Remote / air-mouse pointer hover — so you can always see where you are.
    'a:focus,button:focus,select:focus,input:focus,[tabindex]:focus{outline:3px solid var(--color-accent-400,#7a8fd8)!important;outline-offset:2px!important}' +
    'a:hover,button:hover{outline:3px solid var(--color-accent-400,#7a8fd8)!important;outline-offset:2px!important}' +
    '.group:hover .tilt,.group:focus .tilt{outline:3px solid var(--color-accent-400,#7a8fd8);outline-offset:2px}'

  // 12. lightningcss lowers what it can (logical props, prefixes) and
  //    re-parses everything — our safety net against bad surgery above.
  const out = transform({
    filename: 'app.css',
    code: Buffer.from(css),
    minify: true,
    targets: { chrome: 53 << 16 },
    errorRecovery: true,
  })
  for (const w of out.warnings ?? []) {
    console.warn(`  downlevel-css warning: ${w.message}`)
  }
  return out.code.toString()
}
