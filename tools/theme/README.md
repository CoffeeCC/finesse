# Theme assets and controlled UI fixture

Arcane Table includes generated raster table/card artwork and original Blender orb/deck models. Blender is not required to run or build Finesse. Runtime artwork is WebP; model files are self-contained GLB.

Edit the three sources in tools/theme/scenes, or regenerate them with Blender 5.2:

    blender --background --python tools/theme/create-scrying-orb.py
    blender --background --python tools/theme/create-deck-trinkets.py

Those scripts render PNG stills. Encode newly rendered files with the optional Python Pillow tool:

    python tools/theme/encode-runtime-art.py

Original image-generation prompts for the table/frame/card back are stored beside this README. Asset provenance and licensing are in ASSET-LICENSE.md.

For disposable edge states, run node tools/theme/fixture.mjs. Start a separate Vite instance pointing FINESSE_SERVER=http://127.0.0.1:38212. The fixture binds only to loopback and supplies a fake passwordless Theme Fixture profile, not real media services. Select Arcane Table in Settings → Themes. Edit theme-fixture-state.json and reload to choose single, empty, no-libraries, slow (3 seconds), error (503), or hang. The one-card state has a long name and no art. Do not induce these outages on a real service.

npm run theme:test runs six deadline/cancellation tests. See docs/THEMES.md and docs/THEME-AUTHORING.md for current behavior, authoring and manual verification requirements.
