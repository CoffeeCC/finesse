# Making a theme for Finesse

Author guide — 31 October 2026. Applies to the optional-theme branch based on
Finesse 3.2.5 (88e4e81), not an already-released public theme API.

## What you can make today

A contributor can add a palette, backgrounds, card treatments and motion in the
source, register the theme, then build Finesse. An advanced contributor can supply
a different Home composition, as Arcane Table does. The current app cannot import a
theme ZIP or load a community theme from Settings. The installation format later
in this document is a proposal, not a feature you can use yet.

Start with a surface theme. It is the shortest path to something complete because
it retains the app's browsing, playback, requests, social features and navigation.
Treat a new Home composition as a product feature with its own parity review.

## Your first source theme

1. Start with a Finesse version that includes Settings → Themes.
   Follow AGENTS.md and the existing development setup. Use an isolated preview.
2. Add an entry to THEMES in src/lib/theme.ts before `] as const`:

```ts
{ id: 'velvet-room', name: 'Velvet Room',
  description: 'Plum surfaces and warm paper.',
  swatches: ['#15101a', '#382c42', '#e6dfcf'] },
```

Use a stable, unique lower-case ID. The ThemeId union and picker are derived from
this registry. Do not write localStorage or a second settings screen yourself.
The existing setTheme/useTheme API handles selection and subscriptions.

3. Add scoped styles to src/themes.css, or import a separate stylesheet from
   src/main.tsx after index.css. For example:

```css
html[data-theme="velvet-room"] {
  --color-ink-950: #15101a;
  --color-ink-900: #201927;
  --color-ink-800: #2a2133;
  --color-ink-700: #382c42;
  --color-ink-400: #b7afbf;
  --color-ink-200: #e6dfcf;
}
html[data-theme="velvet-room"] body {
  background: radial-gradient(ellipse at 80% 0%, #51375444, transparent 65%), #15101a;
}
html[data-theme="velvet-room"] .theme-scene[data-preview="velvet-room"],
.theme-scene[data-preview="velvet-room"] {
  background: linear-gradient(135deg, #513754, #15101a);
}
```

The preview selector intentionally works even when another theme is selected.
These values are a starting palette, not proof that every rendered combination
passes contrast checks. Test the actual UI before distributing your work.

4. Keep artwork under src/assets/themes/velvet-room/. Use relative CSS URLs or
   imports so Vite resolves the web base and bundles assets for TV. Do not assume
   `/assets` is hosted at the domain root: the web app lives under /finesse/.
5. Open Settings → Themes. The new choice appears automatically. Select it,
   reload, navigate through real content and switch back to Finesse. Confirm no
   styles remain after switching.

## Existing style hooks

| Hook | Current meaning |
| --- | --- |
| --color-ink-950 / 900 / 800 / 700 | Background and increasingly raised surfaces |
| --color-ink-400 | Secondary labels and descriptions |
| --color-ink-200 | Primary body text |
| --font-sans / mono / display | Body, compact labels and display headings |
| --color-accent-* | Existing account accent; leave user choice intact |
| html[data-theme="your-id"] | Scope for all theme overrides |
| .theme-scene[data-preview="your-id"] | Small Settings preview |

These hooks exist today but are not a versioned public compatibility contract.
Many components still use specific colors, class names and local variables.
Changing the six ink tokens alone will not restyle every dialog or player control.
Prefer a small scoped component override where needed; avoid broad !important
rules, globally overriding button/link styles, or changing media dimensions.
Do not recolor the video or subtitles through an ancestor filter.

## A layout theme

HomePage currently chooses CardTable only for `card-table`; other themes use
StandardHome. Adding a registry entry does not register a new layout automatically.
For a reviewed source contribution, import your Home component and add an explicit
branch beside the CardTable branch. Keep the data hooks and route contracts.
Do not duplicate authentication, playback or download logic in a theme.

Map the normal flows before coding: discovery, Continue Watching, next episode,
saved picks, friend content, requests/download visibility and Home customization.
A picturesque replacement that removes these flows is incomplete.
Arcane Table is intentionally a movie/show discovery Home. Continue Watching is
present there; its Full Finesse Home link opens /dashboard with the complete
StandardHome and shared theme colors. Other media retain their original layouts.

Keep native links for navigation and native buttons for actions. Native controls
need accessible names and selected/busy state. Focus rectangles must remain stable
while decorative artwork animates. Keep the current title and focus when the user
rotates or folds the device. Resizing must not draw another hand or start playback.

## The polish standard

Design the default, selected, hover, pressed, keyboard-focused, disabled, loading,
empty and error states together. Match outline radius to the actual control.
Keep secondary text readable; tiny decorative card captions cannot be the only
place users can read a title. Every important action needs a visible label or an
unambiguous accessible name. Never depend on hover to reveal required controls.

Use original art or assets you have rights to distribute. Include source files,
license information and a compressed runtime version. Do not bundle library
posters, credentials or screenshots with personal data in a public theme package.
Avoid remote fonts, trackers and external asset dependencies. Asset loading must
not block interaction. The active showcase uses larger raster assets plus a Blender
GLB and an optional Three.js renderer. Measure delivered bytes and decoded memory;
do not use the earlier prototype's size as the current budget.

Animate transforms and opacity, clean up timers/listeners, and stop decorative
motion under prefers-reduced-motion. An animation cannot determine whether data
has finished loading. Give real requests cancellation, useful errors and Retry.
Do not autoplay extra sound. Existing playback and subtitle behavior take priority.

## Expanding a theme beyond Home

Use one material and typography system across discovery, libraries, title details,
search, saved picks, settings and menus. Arcane Table demonstrates shared treatments
in src/arcane-surfaces.css and optional wayfinding in ThemePageBanner.tsx. Current
surface hooks include data-theme-surface on catalogue, search, journal, library
hub and detail containers, and data-theme-search on the search panel. These are
source-author hooks, not a versioned community-pack contract.

Decorative frames must not intercept pointer input or cover badges and controls.
The example uses aria-hidden frame spans with pointer-events:none and explicitly
positions progress and action badges above them. Keep alternate layouts, filtering,
virtualization, lazy loading, previews, episode selection and playback intact.
Always check the unchanged default theme as well as your new one after changing
shared markup. Keep theme-only components null for other theme IDs.

## Blender and live 3D

The showcase is a hybrid, not an entirely 3D app. Its board, frames and draw pile
are rendered images. Its Search orb and first two library boxes are Blender models
rendered live with Three.js. Study tools/theme/create-scrying-orb.py,
tools/theme/create-deck-trinkets.py, src/components/ScryingOrb.tsx,
src/components/DeckTrinket.tsx and src/components/TableNavigation.tsx.

For hinged props, preserve named pivot and content nodes when exporting. The
deck-box contract uses LidPivot for the lid hinge and CardLift for the card packet.
Keep animation independent of hover hit targets; keyboard focus must offer the
same behavior. Open on hover/focus, close on exit/blur, and keep touch activation
usable without a hover prerequisite. A native selection action must never depend
on whether a hinge animation has completed. Bound the number of live scenes:
this prototype allows two live boxes plus one orb and uses stills for extra decks.

1. Model in Blender with a deliberate scale, consistent material names and a clear
   silhouette. Keep bevels where they matter at the displayed size; avoid geometry
   that only appears in a close-up render. Preserve an editable .blend source.
2. Export a self-contained GLB. Apply modifiers; use exportable materials. Blender
   procedural node graphs do not automatically become browser shaders. Bake useful
   texture detail or author a runtime shader intentionally. Include asset licenses.
3. Render a matching transparent still. A new theme must remain fully usable if
   WebGL is unavailable, model loading fails, the user disables 3D, or TV/reduced
   motion selects the still. Keep accessible button text outside the canvas.
4. Choose coherent runtime light directions, environment reflections and exposure.
   A live light in an isolated orb cannot illuminate a separately baked table image.
   Real shadows across all objects require a shared live scene and receiving geometry.
5. Import optional rendering code on demand. Cap resolution and frame rate, pause
   offscreen and in hidden tabs, and dispose geometry, materials, environments,
   observers and animation callbacks on unmount. Handle context loss gracefully.
6. Motion must enrich a clear action. Use subtle internal movement and a small
   hover/focus response; keep the native hit target fixed. Never require dragging
   a 3D object or operating a camera to search, navigate or play media.

Do not copy the showcase's private component selectors as a public plugin API.
Community packages do not currently execute imported JavaScript or install models.
A live 3D theme is a reviewed source contribution until a stable contract exists.

## Phones, tablets, foldables and TV

Make the single-screen phone version first. At 320 pixels wide, maintain at least
44-by-44-pixel targets for your new controls, readable content and no page overflow.
Test 390 pixels too. Use a different composition when space changes; shrinking the
desktop scene uniformly is rarely sufficient. Reserve clearance for fixed bottom
navigation, safe areas, on-screen keyboards and enlarged text.

At tablet widths, use the extra space without stretching physical objects into
ovals. Check portrait and landscape, browser split-screen and resizing in place.
Foldables need segment-aware enhancement, not a user-agent model-name list. See
FOLDABLES-AND-THEME-PACKS.md for proposed hinge-aware layouts and fallbacks.
No foldable-specific renderer has been added in this prototype yet.

Use var(--vw, 1vw) / var(--vh, 1vh) for viewport-scaled scene dimensions so TV UI
zoom works. Chromium 68 is a supported TV target: consult webos/downlevel-css.mjs
before introducing newer CSS. Keyboard arrows, Enter and Escape should work through
the existing spatial navigation. A passing TV build is not a physical remote or
gamepad test. Prefer simpler scene rendering on constrained devices.

## Review and handoff

Run npm run theme:test, npm run build and npm run build:webos. Before pushing,
AGENTS.md additionally requires server:typecheck and server:test. Add a tour scene
under tools/tour for a new feature. Record which checks actually ran and any errors.

Review Home, library hub, catalogue/filtering, search, item details, saved picks,
requests, social screens, Settings, menus/dialogs, and playback controls/subtitles.
Exercise long and missing titles/art, no libraries, one card, many libraries,
loading, disconnected server, retry, keyboard focus and theme switching. Confirm
layout does not jump when selecting a card. Test reduced motion, zoom and text size.
Use the isolated fixture documented in tools/theme/README.md for outage states.

Include screenshots at 320, 390 and 768 pixels and a desktop size; document tested
orientations, physical devices, contrast and screen-reader coverage. Report any
unsupported route or missing Home flow. Never label a theme fully verified from
screenshots or a successful build alone.

## Community sharing: next step

Today, share a source patch/branch with preview images, license and test notes.
For ordinary users, we should add a Preview → Apply → Revert installation flow
using validated theme manifests and assets. That requires an importer, stable
semantic tokens and layout presets, which do not exist yet. The companion design
proposal describes that system without promising that arbitrary CSS/JavaScript
can be safely imported into an authenticated media app.
