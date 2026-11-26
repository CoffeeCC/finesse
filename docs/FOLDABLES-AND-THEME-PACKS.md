# Foldable layouts and community theme packs

Design proposal — 31 October 2026. This document does not claim implementation.
The current tabletop has responsive phone/tablet/desktop layouts; it does not yet
read viewport segments, avoid a hardware hinge or import external theme packs.

## Use the extra screen deliberately

| Device configuration | Proposed Finesse behavior |
| --- | --- |
| Narrow cover screen / normal phone | Existing single-column flow; all actions remain available |
| Wide uninterrupted inner display | Hand/table on one side; selected title and Continue Watching on the other when panes fit |
| Two side-by-side viewport segments | Entire interactive table in one segment; selected details and Resume in the other; hinge stays empty |
| Two vertically stacked segments | Preview/details above; hand, deck and browsing actions below, subject to pane size |
| Partially folded tabletop posture | Same stacked arrangement when actual segment information supports it; do not infer hinge coordinates from posture alone |
| Unsupported browser or app in one segment | Standard responsive layout; optional user-selected compact/two-pane mode when space permits |
| Separate independent screens/windows | A distinct companion-window feature; not automatically the same as spanning a foldable viewport |

Do not split the five-card hand across a physical hinge or put Play/Back on it.
Each pane has a minimum usable size. If a scene cannot fit in one segment, switch
to a compact hand/list rather than crop it. Keep global navigation reachable from
the active segment. Decorative background can span uninterrupted displays; real
controls should respect the actual available segments and safe areas.

For the card theme, a useful book layout is a small complete mat plus hand on the
left, and a larger selected poster, synopsis, Open title and reservation slips on
the right. This provides a benefit over merely making everything bigger. A stacked
layout can keep browsing controls within reach while the preview stays above.
Do not start a preview just because the phone folded, or move an active video
without retaining its playback element/state.

## Detection and graceful fallback

Use layout dimensions as the baseline. Where supported, CSS horizontal-viewport-
segments and vertical-viewport-segments report segment counts. Indexed viewport-
segment environment variables provide the segment bounds. Device Posture supplies
continuous/folded state; that state alone does not locate a hinge. These APIs have
limited browser support, so none can be a prerequisite for normal navigation.
Sources: [W3C CSS Environment Variables](https://www.w3.org/TR/css-env-1/#viewport-segments)
and [W3C Device Posture](https://www.w3.org/TR/device-posture/).

The app shell should calculate usable pane rectangles once and expose a stable
layout context to every theme: single, wide, book or stacked; pane bounds; excluded
hinge bounds when known; reduced motion and input mode. Authors should not each
build their own device detector. No model-specific user-agent checks or hinge-angle
guesses. Do not collect posture telemetry to make a layout work.

Illustrative detection, not a drop-in stylesheet for the current nested table:

```css
/* Default layout must remain complete without these queries. */
@media (horizontal-viewport-segments: 2) {
  /* Shell places panes using reported segment bounds, not an assumed 50/50 split. */
}
@media (vertical-viewport-segments: 2) {
  /* Shell places stacked panes and excludes the gap. */
}
```

Environment coordinates are viewport-relative. Nested scenes must account for the
header, navigation, scroll and their own offsets; directly applying segment widths
to the current table is not enough. Recalculate geometry when orientation, viewport
or posture changes without resetting selection, hand, scroll context or playback.
Provide a conventional layout if metrics disappear. Browser split-screen can look
narrow even on a large device; physical screen size is not the usable viewport.

Before claiming support, emulate both segment orientations and hinge gaps, then
exercise real hardware. Resize a paused and playing session, focus controls on both
sides, open the keyboard, rotate, fold/unfold and enter/exit fullscreen. Verify no
important control lies under the hinge or system UI. Emulated phone dimensions
alone are not foldable verification. Physical foldables have not been tested here.

## Let ordinary users make and share themes

Use two extension levels:

1. **Theme packs:** validated colors, materials, fonts from the app's approved set,
   local images, card/deck skins, supported motion presets and layout preset choice.
   These can be imported without compiling Finesse once an importer exists.
2. **Layout contributions:** reviewed source components for genuinely different
   experiences, such as the card table, observatory or record-store concept. These
   require app review until a sufficiently expressive declarative layout system exists.

A palette ZIP should not be advertised as capable of supplying any new interactive
world. Custom interaction code is a different extension contract.

Proposed archive structure:

```
velvet-room/
  theme.json
  preview.webp
  assets/
    background-phone.webp
    background-wide.webp
    card-back.webp
  LICENSE.txt
  README.md
```

Proposed manifest example — NOT accepted by the current app:

```json
{
  "schemaVersion": 1,
  "id": "community.velvet-room",
  "name": "Velvet Room",
  "author": "Your name",
  "version": "1.0.0",
  "license": "CC-BY-4.0",
  "layout": "standard",
  "tokens": {
    "background": "#15101a",
    "surface": "#201927",
    "text": "#e6dfcf",
    "mutedText": "#b7afbf",
    "focus": "#b7dce9"
  },
  "assets": {
    "phoneBackground": "assets/background-phone.webp",
    "wideBackground": "assets/background-wide.webp"
  },
  "motionPreset": "subtle"
}
```

The exact schema and app compatibility range need implementation and versioning.
Semantic tokens should cover surfaces, text, focus, borders, feedback states,
player overlays and disabled states, rather than expose internal class names.
The app owns minimum touch targets, safe-area/hinge layout, contrast validation,
media legibility and reduced motion. A pack can supply art direction without
silently removing these behaviors. Allow preserving the user's account accent.

## Creator and installer flow

A built-in creator should offer a live preview with device/segment presets, color
and material controls, local asset uploads, card-back design, motion presets and
export. Make failure/empty states visible in preview as well as attractive full
libraries. Start with a small set of stable layout presets. Foldable layouts must
have a conventional single-screen fallback before a theme can be exported.

Installation: choose pack → inspect name/author/license/compatibility → preview
against local library → Apply. Keep a persistent Return to Finesse action and an
automatic rollback if the theme fails to load. Preview must not overwrite the
currently saved theme until Apply. Store packs locally; account sync is a separate
product choice and should not transfer large art files implicitly.

For pack validation, allow only documented token fields, known layout/motion IDs
and local asset paths. Bound archive size, file count and decoded image dimensions;
reject path traversal, external URLs, executable scripts and unknown manifests.
Use raster art initially; accepting SVG requires explicit sanitization or safe
rasterization. Arbitrary community CSS can obscure account/settings screens or
request external assets, so do not make it the default import format. Reviewed
source themes can remain available to advanced contributors.

## Suggested delivery order

1. Finish the responsive built-in movie/show theme and retain full Home access.
   The current prototype now links to the complete themed Home at /dashboard.
2. Extract semantic tokens and the shared pane/layout context.
3. Build a versioned pack schema, sample pack and validation tests.
4. Add local preview, Apply/Revert, asset handling and recovery.
5. Add the visual creator and export; publish author docs with the actual schema.
6. Verify foldable enhancement on supported hardware, then consider a gallery.

No gallery, account synchronization, second-window controller, foldable-aware shell
or pack importer is implemented by this proposal. Those are separate build tasks;
the source-theme guide is usable with the current branch today.
