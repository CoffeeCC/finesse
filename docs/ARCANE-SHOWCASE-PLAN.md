# Arcane Table showcase production plan

Approved direction, 1 November 2026. Work continues on `feat/arcane-table-theme`; no merge or deployment is authorized by this document. Status is recorded explicitly below.

## Experience and quality bar

A collector's celestial fantasy desk, with blue leather, aged bronze, carved wood, warm wax and moonlit glass. Home deals a discovery hand; full-library browsing opens a collection folio. Generated illustrations supply rich textures and ornament. Blender supplies modeled objects, bevels, depth, material response, pivots and light. Avoid a standard media grid with ornamental borders. Keep Finesse's complete media functionality available and its default theme intact.

Consistent light direction, contact shadows, object scale and material response are mandatory. Do not claim that a CSS glow physically illuminates a model, or that separate WebGL canvases share shadows. Clearly document raster/baked and live-lit boundaries. Key objects have meaningful, interruptible animation; no continuous spectacle or unsolicited ambient sound. Approved action sounds follow the existing interface-sound preference and volume.

## Work packages

1. **Collection folio:** a bound blue-leather album on the desk, cards in inset slots, library dividers, readable labelled search/genre/watch/sort controls. Real server pagination reaches the entire library, including search results beyond the first page. A selected card lifts into an inspection space. Desktop uses board + inspection; phones use two readable columns and a focused inspector. Preserve position and filters on Back. Loading/error/empty/missing-art states belong to the same visual system.
2. **Inspection and saved collection:** title presentation belongs to the folio; Play/resume/start-over, versions, episodes, cast, My List, favorites, requests, parties and Moments remain discoverable. My List becomes a personal folio. Specialized music/games/social/settings screens share designed materials and navigation without losing their functions. Community-theme documentation explains current source hooks and future pack proposals separately.
3. **Blender assets and shared lighting:** candle/holder, wax geometry, folio cover/binding/fittings and representative card geometry. Reuse approved orb/deck models and illustrated frame/poster artwork. Put objects receiving a candle light in one scene; use a bounded renderer, shared textures and explicit disposal. Progressive enhancement provides still art when WebGL is off/unavailable. Arcane Table stays excluded from TV until device verification.
4. **Candle:** sculpted bronze holder, aged wax, recessed wick, warm translucent edges. Flame bends subtly; brightness varies smoothly. Slow wax beads travel down channels and settle. Approximately 45 visible minutes to burn down; no burning while the tab is hidden. Burn progress survives navigation in the same browser session. Browser-closed time does not consume the candle. Motion-off keeps steady light and disables decorative movement.
5. **Burnout and moonlit screensaver:** defer burnout until idle; never interrupt media, typing, menus/dialogs or requests/deals. Guttering flame, ember, smoke, darkness and cool moonlight. The same desk remains, cards resting, UI hidden, faint orb constellations and sparse motes. No fixed bright HUD. Wake restores the prior UI, relights the wick and starts a fresh candle. Reuse Finesse's screensaver preference and wake handling rather than competing idle timers. A waking press must never activate a hidden underlying control; mouse movement can wake before a later intended click. Keep playback and navigation guards.
6. **Polish and verification:** coherent desktop/phone compositions; keyboard/controller semantics, focus return, reduced motion, live-3D-off, WebGL failure and context loss. Pause rendering offscreen/hidden, cap pixel ratio/FPS and reduce mobile shadows. Visual screenshots and short animation study before calling the showcase complete. Test timer boundary and activity/playback deferral with an accelerated development-only mode. No camera/mic permissions.

## Assets and motion

| Asset | Source | Motion |
|---|---|---|
| Desk/mat | Approved illustrations + material geometry | Candle falloff, moonlight transition |
| Collection folio | Blender geometry + leather/ornament artwork | Cover/page reveal, restrained page change |
| Media cards | Actual posters + approved frame + card geometry | Lift, settle, inspection transition |
| Deck boxes | Existing Blender sources | Lid hinge and card lift |
| Search orb | Existing Blender source + runtime shader | Swirl, constellation drift, search response |
| Candle/holder | New editable Blender source | Burn height, flame, wax bead, ember/smoke, relight |

## Validation and acceptance

- A user can browse every page, filter, select, inspect, return, and play a title without losing place.
- The full deck has a distinct composition, not merely a new palette/frame.
- Candle light demonstrably changes nearby live material highlights and receiving surfaces in a shared scene. Document remaining baked artwork.
- Idle alone can hide UI; an active user or media session is never interrupted. Screensaver off is respected immediately.
- Timer testing does not require waiting 45 minutes; test controls are development-only and cannot alter production behavior.
- Default theme has no new scene/art downloads. TV build excludes this theme. No new server dependency or credential exposure.
- Run web/TV builds, theme tests, server type-check and required server checks before pushing; report platform failures honestly. GitHub checks must pass. Physical device/contrast/screen-reader certification is separate work.

## Planned next pass — candlelight and physical action props

Requested 1 November 2026. **Implemented in the preview; exercised behavior and remaining release limits are recorded in ARCANE-SHOWCASE-QA.md.** Keep the existing search orb, coin and library boxes as the material reference. The physical controls must read as objects on the same desk, not illustrated rectangular buttons.

### Candlelight that feels alive

The current renderer already modulates the candle's actual point light with two small sine waves. This is easy to miss and too regular to be the final motion design. Replace it with bounded, smoothly varying irregular flicker: a slow breathing envelope with much smaller fast flutter. Drive flame lean, direct warm light and tiny light-source movement from the same signal so the visible flame, bronze highlights and receiving shadows agree.

- Start with restrained roughly 8–12% intensity variation, then tune by viewing the scene at normal size. No sharp flashes or conspicuous looping pattern.
- Keep camera exposure, cool ambient fill, text and normal UI steady. The effect belongs to the candle's warm light, nearby materials and shadows; do not pulse the whole page with an overlay.
- Add only very small light-position changes around the wick, enough for soft shadow movement and glints on coin rims, box fittings and the new action props. Do not wobble the entire candle or move shadows independently of their source.
- Preserve the 45-minute visible-time burn, wax beads/pooling, idle guards, gutter/ember/smoke, moonlight and relight. Scale the flicker down with the dying flame; keep a steady light under reduced motion or Animations off.
- Live-3D-off retains the matching art and a restrained local flame/halo treatment. Document that the still fallback does not acquire real moving cast shadows.

### Open title → a small story codex

Recommended object: a palm-sized midnight-leather book, with a worn bronze clasp, layered page edges, subtle celestial tooling and a ribbon bookmark. A book communicates opening a story and fits the collection folio already used elsewhere in the theme. Avoid introducing another orb or a second coin with an unrelated meaning.

- Model it in Blender with an actual cover hinge and clasp pivot; reuse the existing leather/bronze palette and original ornament where useful. Supply matching transparent still art.
- At rest, a quiet physical object with contact shadow. Hover or keyboard focus lifts the clasp and cracks the cover a few degrees, revealing warm page edges. Leaving settles it. The native hit target remains stationary.
- Keep a clearly readable **Open title** label and the selected title's accessible context. Activation follows the existing title-details link immediately; a decorative animation must not delay navigation or start playback.
- A restrained existing object sound may accompany activation, subject to the current sound/media guards. No idle book noises, bright perpetual glow or animated floating label.

### Deal again → the actual draw deck

Upgrade the existing draw pile into a modeled, slightly askew stack of celestial-backed cards. Make this the single labelled **Deal again** action. Its existing shuffle/deal behavior is already correct; the work is a physical presentation upgrade, not a second randomization implementation.

- Blender card stock with visible layered edges, softened corners and the approved back artwork. Use named packet/top-card pivots for a gentle focus riffle, small top-card lift, collect, shuffle and draw cues.
- Reuse the existing deal callback, request cancellation/deadline, busy state and card-flight origin. Data readiness still controls when the next hand appears.
- Remove the duplicate flat Deal again button only after the physical deck offers equivalent labelled pointer, touch, keyboard and controller activation. Keep it visible on phones; the current phone layout hides the old decorative stock.
- During a request, keep an obvious **Dealing…** state and prevent repeated deals. Native error/retry remains available. Reduce motion resolves to the resting deck without decorative packet movement.

### Composition and implementation order

1. Make a Blender material/lighting study with the codex and draw stack beside the existing candle, orb and coin. Review silhouette, bevels, scale and warm highlights before wiring more animation.
2. Tune the shared candlelight, using the real desk/model receivers. Keep a single renderer and the existing mobile rendering budget.
3. Place the codex and draw deck in the lower action areas with deliberate breathing room. Recompose phone/tablet positions rather than shrinking the desktop arrangement. Leave every resting card corner, coin and label clear; protect separate hit targets and at least 44-pixel activation areas.
4. Connect the original native link/button semantics and existing callbacks, then retire duplicate flat actions. Match still fallback, reduced motion, loading, disabled/busy, focus and error states.
5. Verify 320, 390, 768 and desktop widths, late font/style loading, resize/fold-like width changes, context loss, 3D off, media/idle guards and sound preferences. Inspect flicker on actual bronze/page edges and shadows in a short motion capture. Test the flicker signal's range/continuity and motion-off behavior; do not mistake a bright flame sprite for demonstrated scene lighting.

Acceptance: both actions are immediately understandable and fully usable as physical desk objects; no redundant flat controls, overlapping targets, perpetual spectacle, added renderer or regression in title/deal/idle behavior. This does not constitute physical foldable/controller certification.

### Retained alternate mat artwork

The original ornate, warmly illuminated desktop and phone plates (`celestial-table-v1.webp` and `celestial-phone-v1.webp`) are deliberately retained, at the user's request. Do not delete them as unused assets. A selectable alternate table finish is a future option; it is not implemented by retaining these files. The active quiet desk must use matching fallback art, rather than showing the old mat on each refresh before the live canvas appears. A future alternate finish needs its own coherent lighting composition, including the older image's baked warm illumination.

## Progress log

- Existing baseline: discovery table, Blender orb/deck boxes, optional theme settings, author guide, styled shared surfaces. This is **not** a finished showcase.
- Implemented: actual paginated collection folio; desktop inspector/phone Sheet; saved-story folio; title inspection composition; shared scene and live card relief; Blender candle/holder/wax/book sources; orb/box animations; slow candle and safe moonlight/wake integration; native fallbacks; development-only verification lab.
- Visual review corrected card backing/stacking, book edge protrusion, narrow layouts and context-loss/resize recovery. The new scene was inspected at 320, 390, 768 and desktop widths. Search/filter/page/title/Back and saved add/remove round trips were exercised against the real server.
- Added a packed Blender lighting study, exact generated-art prompts/provenance, updated current-theme documentation and creator guidance. See ARCANE-SHOWCASE-QA.md for specific evidence and limits.
- Local web/TV builds, nine theme tests and server type-check passed. Windows full server tests reported existing path/config/backup failures and the stalled run was stopped; no server code changed. Linux CI remains a separate gate for the pushed commit.
- Checkpoint pushed to draft PR #34; latest master (3.2.6) merged without replacing the prior review stack. GitHub CI passed for implementation head fec8118 (run 41333389968).
- Follow-up refinement: larger orb, clearer deck spacing, original Blender sun/moon coin with live toss/shadow and motion-off/still behavior, and preference-aware glass/box/card/coin sounds. Native props refit after late CSS/font layout changes. Wax pooling remains a slow geometric approximation, alongside moving beads and a shortening body.
- Physical-action pass: original Blender leather codex and draw stack, native link/button states and motion-off/still fallbacks; coherent irregular candle flicker, stationary-holder tending interaction, darker room and wider hover light. Orb now casts a separate stronger blue pool with slow breathing. The painted desk chain has selective metal/roughness/bump relief, not a separate modeled silhouette. Quiet-desk loading art matches the live surface; older plates retained. Local web/TV builds, 15 theme tests, server type-check and tour syntax passed; new-head CI remains a gate.
- Still required before calling this release-ready: physical-device/controller performance and accessibility review, sustained 45-minute idle/endurance checks, cross-server folio exercise and broader player/integration regression. Recheck CI after further changes. Keep preview:true and tv:false. No merge/deploy.

Keep this log updated as implementation and validation actually finish. Source contributions should read this file together with `THEMES.md` and `THEME-AUTHORING.md`.
