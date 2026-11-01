# Theme assets and controlled UI fixture

Arcane Table includes generated raster table/card artwork and original Blender orb/deck models. Blender is not required to run or build Finesse. Runtime artwork is WebP; model files are self-contained GLB.

Edit the three sources in tools/theme/scenes, or regenerate them with Blender 5.2:

    blender --background --python tools/theme/create-scrying-orb.py
    blender --background --python tools/theme/create-deck-trinkets.py

The expanded showcase adds candle/holder/wax sprites and a collection folio:

    blender --background --python tools/theme/create-candle-folio.py

The two-sided sun/moon desk coin has its own source and matching stills:

    blender --background --python tools/theme/create-celestial-coin.py

This writes editable scenes, self-contained GLBs, matching WebP stills and
src/assets/card-table/candle-layout.ts (projected wick/base anchors). Keep that
generated layout file with its matching sprites. The source folio is inset beneath
the illustrated surface so untextured page strips do not protrude at its edges.

Optional material/animation study (not a browser recording):

    blender --background --python tools/theme/render-showcase-study.py

Its packed .blend is portable; the frames are generated outputs and are not runtime
assets. Build/run Finesse without Blender. See showcase-art-prompts.md for the two
additional generated textures and ASSET-LICENSE.md for their provenance.

Those scripts render PNG stills. Encode newly rendered files with the optional Python Pillow tool:

    python tools/theme/encode-runtime-art.py

Original image-generation prompts for the table/frame/card back are stored beside this README. Asset provenance and licensing are in ASSET-LICENSE.md.

For disposable edge states, run node tools/theme/fixture.mjs. Start a separate Vite instance pointing FINESSE_SERVER=http://127.0.0.1:38212. The fixture binds only to loopback and supplies a fake passwordless Theme Fixture profile, not real media services. Select Arcane Table in Settings → Themes. Edit theme-fixture-state.json and reload to choose single, empty, no-libraries, slow (3 seconds), error (503), or hang. The one-card state has a long name and no art. Do not induce these outages on a real service.

npm run theme:test runs thirteen deadline/cancellation, candle-clock and sound-policy tests. See docs/THEMES.md and docs/THEME-AUTHORING.md for current behavior, authoring and manual verification requirements.

## Local scene verification

Vite development only: open /finesse/?theme=card-table&theme-lab=1. The lab offers
an accelerated candle (14s visible burn, 8s idle guard, 6s gutter) and genuine
WEBGL_lose_context testing. Observe the scene, wake with Escape, then try a distinct
Search click. Open a text field/menu/dialog and confirm idle does not interrupt it.
Resize after graphics loss and confirm native artwork/actions remain usable. Normal
production timing is 45 visible minutes and a two-minute idle guard. Lab UI and
accelerated query handling are compiled out of production. Leave normal timing and
no lab enabled for a user preview.
