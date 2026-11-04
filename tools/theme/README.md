# Theme assets and controlled UI fixture

Arcane Table includes generated raster table/card artwork and original Blender orb/deck models. Blender is not required to run or build Finesse. Runtime artwork is WebP; model files are self-contained GLB.

Edit the original sources in tools/theme/scenes, or regenerate them with Blender 5.2:

    blender --background --python tools/theme/create-scrying-orb.py
    blender --background --python tools/theme/create-deck-trinkets.py

Correspondence props and the distinct navigation instrument set:

    blender --background --python tools/theme/create-correspondence-props.py
    blender --background --python tools/theme/create-navigation-trinkets.py

Articulated desk/lock and the distinct sliding lighting drawer:

    blender --background --python-exit-code 1 --python tools/theme/create-arcane-desk.py

The generator validates independent animation channels before exporting, writes
wide/portrait GLBs and matching open desk/drawer stills, and derives native fallback
surface/hit regions in src/assets/card-table/desk-case-layout.ts. To remeasure packed
scenes without rendering:

    blender --background --python-exit-code 1 --python tools/theme/desk_layout.py

Packed reference ranges: desk frames 1–76; lower drawer frames 77–122. The browser
drives the named pivots with deskSequence.ts, using reversible 1800ms/1200ms
timelines and independent eased cameras. GLBs contain geometry/pivots, not a browser
recording or an animation player. Hardware sound cues are normalized crossing events,
and active voices fade/cancel on direction changes. Fallback art is derived from the
same original scenes; mobile contact shadows are a bounded approximation.

These two generators share blender_prop_tools.py. Each writes editable scenes,
self-contained GLBs and matching transparent WebP stills. See
docs/ARCANE-OBJECT-REGISTER.md for exclusive function identities and which live
animations are implemented versus still planned. Generating a model is not proof
that its interaction or live lighting has been integrated.

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

npm run theme:test runs the current deadline/cancellation, candle-clock, flicker-continuity, bounded/storable scene-setting, route-origin, mechanism and sound-policy checks. See docs/THEMES.md and docs/THEME-AUTHORING.md for current behavior, authoring and manual verification requirements.

`create-collection-tools.py` creates five original collection instruments: ink quill, genre vials, watch lantern, sorting sextant and mineral eraser. It exports matching transparent stills, articulated GLBs and editable packed Blender scenes. Run with `--python-exit-code 1`; pass asset names after `--` to render only selected tools. Named QuillPivot, VialStopperPivot0/1/2, LanternHandlePivot, SextantArmPivot and EraserHandlePivot drive bounded runtime hover/focus motion. The portrait journal plate and its exact prompt are recorded in `collection-journal-prompts.txt`; it is a purpose-made single leaf rather than a squeezed desktop spread.

`create-action-props.py` builds the original story codex and draw deck, exports runtime GLBs and matching WebP stills, and saves packed editable scenes. The leather grain is an original baked procedural normal map. Named CodexCoverPivot/CodexClaspPivot and PacketA/PacketB/TopCard drive runtime interactions. Runtime inlays reuse the shared celestial back texture. `render-action-study.py` creates a packed Blender material/lighting study with the new props and existing candle/orb/coin; its output is not a recording of the application.

The quiet desk chain material in `src/lib/arcaneDeskMaterial.ts` traces the approved artwork, deriving selective metal/roughness and bump relief. It does not generate a separate chain mesh. Keep these maps synchronized with the desk UV crop. The older celestial desktop/phone plates are deliberately retained for a possible alternate finish, not used as a loading placeholder.

## Local scene verification

Vite development only: open /finesse/?theme=card-table&theme-lab=1. The lab offers
an accelerated candle (14s visible burn, 8s idle guard, 6s gutter) and genuine
WEBGL_lose_context testing. Observe the scene, wake with Escape, then try a distinct
Search click. Open a text field/menu/dialog and confirm idle does not interrupt it.
Resize after graphics loss and confirm native artwork/actions remain usable. Normal
production timing is 45 visible minutes and a two-minute idle guard. Lab UI and
accelerated query handling are compiled out of production. Leave normal timing and
no lab enabled for a user preview.


`create-portrait-folio.py` packs the original portrait journal plate into a leather/gilt/binding model with PortraitLeafPivot and a matching blue underleaf. Reference hinge samples assert that the writing surface clears its support. The browser uses folioMotion.ts for mirrored, bounded opening/turn motion, with reduced-motion stillness.

`create-dispatch-tools.py` exports original escapement, shears and courier-horn models, transparent stills and packed editable scenes. Run Blender with `--background --python-exit-code 1 --python tools/theme/create-dispatch-tools.py`. Named EscapementLeverPivot, ShearLeftPivot, ShearRightPivot and CourierHornPivot animate in the existing folio renderer. No per-row canvas is added. Runtime clipping follows the scrollable writing area; stale loads must never hide a replacement owner's fallback.

The loopback-only fixture supports mode `dispatch` in theme-fixture-state.json. It provides one long no-art saved title and a disposable in-memory Radarr/SAB queue; pause/resume/delete/search actions never contact external services. `/__fixture/events` is local proof, and POST `/__fixture/reset` resets only this test queue. Restore the state file after testing. Actual UI event evidence belongs outside public assets; do not include account headers, private library images or browser storage.
