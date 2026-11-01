# Arcane Table showcase production plan

Approved direction, 1 November 2026. Work continues on `feat/arcane-table-theme`; no merge or deployment is authorized by this document. Status is recorded explicitly below.

## Experience and quality bar

A collector's celestial fantasy desk, with blue leather, aged bronze, carved wood, warm wax and moonlit glass. Home deals a discovery hand; full-library browsing opens a collection folio. Generated illustrations supply rich textures and ornament. Blender supplies modeled objects, bevels, depth, material response, pivots and light. Avoid a standard media grid with ornamental borders. Keep Finesse's complete media functionality available and its default theme intact.

Consistent light direction, contact shadows, object scale and material response are mandatory. Do not claim that a CSS glow physically illuminates a model, or that separate WebGL canvases share shadows. Clearly document raster/baked and live-lit boundaries. Key objects have meaningful, interruptible animation; no continuous spectacle or extra sound.

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

## Progress log

- Existing baseline: discovery table, Blender orb/deck boxes, optional theme settings, author guide, styled shared surfaces. This is **not** a finished showcase.
- Implemented: actual paginated collection folio; desktop inspector/phone Sheet; saved-story folio; title inspection composition; shared scene and live card relief; Blender candle/holder/wax/book sources; orb/box animations; slow candle and safe moonlight/wake integration; native fallbacks; development-only verification lab.
- Visual review corrected card backing/stacking, book edge protrusion, narrow layouts and context-loss/resize recovery. The new scene was inspected at 320, 390, 768 and desktop widths. Search/filter/page/title/Back and saved add/remove round trips were exercised against the real server.
- Added a packed Blender lighting study, exact generated-art prompts/provenance, updated current-theme documentation and creator guidance. See ARCANE-SHOWCASE-QA.md for specific evidence and limits.
- Local web/TV builds, nine theme tests and server type-check passed. Windows full server tests reported existing path/config/backup failures and the stalled run was stopped; no server code changed. Linux CI remains a separate gate for the pushed commit.
- Checkpoint pushed to draft PR #34; latest master (3.2.6) merged without replacing the prior review stack. GitHub CI passed for implementation head fec8118 (run 41333389968).
- Follow-up refinement: larger orb, clearer deck spacing, original Blender sun/moon coin with live toss/shadow and motion-off/still behavior, and preference-aware glass/box/card/coin sounds. Native props refit after late CSS/font layout changes. Wax pooling remains a slow geometric approximation, alongside moving beads and a shortening body.
- Still required before calling this release-ready: physical-device/controller performance and accessibility review, sustained 45-minute idle/endurance checks, cross-server folio exercise and broader player/integration regression. Recheck CI after further changes. Keep preview:true and tv:false. No merge/deploy.

Keep this log updated as implementation and validation actually finish. Source contributions should read this file together with `THEMES.md` and `THEME-AUTHORING.md`.
