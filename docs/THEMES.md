# Arcane Table — current implementation

Updated 1 November 2026. Optional preview theme on `feat/arcane-table-theme`, based on Finesse 3.2.6. Not a released theme API or a device certification.

## Experience

Home deals five real movie/show cards on a celestial leather desk. The deck boxes choose actual libraries; the stock collects, shuffles and deals another hand. Phones display the selected card and its neighbors with paging. Continue Watching, Full Finesse Home (`/dashboard`), all libraries, Search, My List, account, Moments and Quick menu remain reachable.

Browse full deck opens a collection folio rather than the normal poster grid. Movie/show libraries, including shared movie/show libraries, use six cards per leaf with actual server pagination and a direct leaf control. Search, genre, watch state and sorting use the existing media client. Selection, filters and leaf are recorded in the URL for returning from a title. Desktop/tablet show an inspector on the facing page; phones show two columns and open an existing accessible Sheet for inspection. Native links open the title or player. Missing art, loading, empty, timeout and retry states retain the same materials.

My List becomes a saved-story folio with the existing requests/downloads section beneath. Title details compose the original poster, metadata and actions into the inspection book. Existing versions, episodes, cast, recommendations, playback, favorites and social actions retain their original implementations. Search, library hub and specialized music/games/social/settings routes share the palette and wayfinding. This theme deliberately specializes movie/show discovery; it does not replace every specialized layout with a 3D desk.

## One light space

`ArcaneLighting.tsx` owns one Three.js scene per active desk: receiving desk geometry, candle, orb, first two library boxes, folio and enhanced resting cards share the same lights. Blender sources provide real bevels, material response, hinge pivots and wax geometry. A warm flickering point light, cool moon key and restrained environment reflections illuminate them; desktop uses soft shadow maps. The orb has a runtime nebula shader and drifting stars. Boxes hinge open on hover/focus or busy dealing. Folio leaves settle when opened and shift gently on a page change.

Generated artwork supplies desk textures, the illustrated book surface and relief card-frame textures. The Home Open title control is a Blender leather codex with a hinged cover/clasp; Deal again is a modeled draw stack whose packets follow the existing shuffle phase. Both retain native link/button semantics, matching stills and readable labels. Resting Home cards and desktop folio cards add modeled card stock and live-lit relief; poster faces preserve source colors and dim in moonlight. Native HTML controls retain hit targets, focus, selection and accessible names, and remain the fallback until each texture is ready. Phone folios use illustrated leaves/native cards; phone title inspection uses the still composition. This is a hybrid raster/geometry scene, not browser path tracing or fully modeled ornament. Normal DOM text/actions are not physically lit.

The painted desk chain has selectively masked metallic/roughness and bump relief maps derived at initialization from the original artwork. Its edges respond to the shared lights, but it has no freestanding geometry, silhouette or separate cast shadow. All material maps follow the desk's phone UV crop. The orb has a stronger cool-blue point light and a soft local halo, with slow breathing distinct from candle flutter; it dims in moonlight. Reduced motion holds both sources steady. Live 3D off retains still artwork without moving illumination.

The active fallback uses the same quiet desk as the live receiving plane, with no canvas opacity fade. The original ornate celestial desktop/phone plates remain in source at the user's request; a selectable alternate finish is not implemented.

Settings → Themes → Table lighting offers per-browser Scene brightness (70–140%) and Light strength (50–150%), plus reset. They affect the live scene and are disabled with Live 3D off; poster faces and native text retain their colors. Invalid/blocked storage falls back safely. The candle's point-shadow filtering is broader and its shadow contribution lighter, with a restrained unshadowed warm bounce approximation. This is not path-traced global illumination. Live leather/metal materials add fine procedural roughness/bump grain where UVs and authored maps allow it; existing Blender normal maps are preserved. Smaller orb emitters use proportionately less power so title/folio pages do not bleach.

Home draws now use measured stock-to-card scale and a higher per-card arc, staggered reveals and a small landing settle. Quiet landing sounds only follow deliberate deals/deck changes, obey sound/media/visibility settings, and are cancelled on leaving the phase; initial loading does not cue them. Motion-off bypasses the sequence. Selected card elevation eases toward its target instead of popping. Collection pages and title actions share more tactile material treatments, while retaining the original controls and data flow.

The first two Home boxes are live; additional libraries use stills. Pixel ratio is capped at 1.5 on desktop and 1 on phones; scene updates are capped around 30/20 fps. Phone shadows are disabled. Rendering pauses offscreen/hidden and all scene resources/listeners are disposed on unmount. Live 3D objects off, initialization failure or graphics-context loss restores usable art. Resizing after context loss must not hide that fallback. Reduced motion keeps geometry and steady illumination but stops decorative movement; it does not require disabling 3D.

The older isolated `ScryingOrb`/`DeckTrinket` renderers remain in source but TableNavigation disables their live mode. Do not enable them alongside the shared scene: isolated canvases do not share light or shadows.

The orb has a larger silhouette than the candle, and the deck boxes have individual clearance. A two-sided Blender sun/moon coin is a native desk toy: activate it to toss, rotate, land and read the result. It shares the scene's light/shadow space and has matching stills with a CSS fallback. Reduced motion resolves the result immediately. Repeated activation during a toss is ignored while keyboard focus stays on the control. Its result never chooses a library, changes the hand or starts media.

Object actions use original synthesized effects: glass/air for the orb, a soft leather/wood contact for boxes, filtered card rustles and metallic coin flip/landing partials. They use Finesse's existing Interface sounds and volume settings, remain silent during unmuted media/hidden tabs, and do not add an ambient loop. The ordinary confirmation is suppressed for these actions to avoid doubled sounds. Audio is activated by the user's action, never by loading the theme.

## Candle and moonlit idle scene

The original Blender candle has a bronze holder, uneven wax channels/pools and a charred wick. Its flame and actual warm point light share bounded, smooth irregular breathing/flutter, small lean and source movement; ambient fill and exposure stay steady. The darker room makes its warm pool visible. On Home, hovering/focusing Tend the candle grows the flame and increases light strength/range; activation adds a brief breath and preference-aware soft sound without resetting burn progress. The holder stays planted. Motion-off suppresses decorative hover/click pulses. A wax bead occasionally travels down the body, pooled wax slowly expands geometrically, and the wax envelope shortens over approximately 45 visible minutes spent on a themed scene. This is a geometric melt approximation, not fluid simulation. Session storage preserves burn progress across navigation/reload; time with the tab hidden or browser closed does not consume it. The still fallback separates wax from holder so burn height and flame position remain coherent without WebGL.

Finesse's existing Marquee idle system controls burnout. The screensaver preference, two-minute idle guard, active media/player, focused text entry, dialogs, menus, busy content and detail trailers prevent entry. Eligibility is rechecked throughout the six-second gutter. The flame dies, ember and smoke fade, warm illumination falls away, the same desk stays under moonlight and the orb remains faintly visible. UI is hidden and main/navigation surfaces become inert. No camera, microphone, extra audio or server work is involved.

Activity restores the UI and relights a fresh candle. A waking press is consumed so it cannot also activate a hidden control; a distinct next press can act normally. Hidden-tab return counts as activity. Turning the existing screensaver preference off dismisses the scene. Non-desk routes retain the ordinary Finesse marquee.

In local Vite development only, `?theme=card-table&theme-lab=1` exposes an explicit lab for accelerated candle timing (14s burn, 8s idle, 6s gutter) and genuine graphics-context loss. These controls and acceleration are compiled out of production. Never use quick timing as evidence that 45 minutes actually elapsed.

## Settings and loading boundaries

Settings → Appearance → Unfinished themes enables preview choices per browser. Settings → Themes offers selection, Try your theme, Restore Finesse, Live 3D objects and a downloadable author guide. Turning unfinished themes off restores standard Finesse. A local development `?theme=card-table` link selects the theme and persists the preview opt-in; production ignores that shortcut.

Theme styles, illustrations, models and Three.js are lazy. Standard Finesse does not fetch the Arcane scene assets. Arcane remains `preview: true, tv: false`; its scene/art are excluded from the TV build. Do not change those flags merely because builds pass. Theme packs, an importer/editor/gallery, account sync and hinge-aware foldable rendering are not implemented. See `THEME-AUTHORING.md`, `THEME-SYSTEM-PLAN.md` and `FOLDABLES-AND-THEME-PACKS.md`.

## Sources and verification

`ARCANE-SHOWCASE-PLAN.md` records scope/status; `ARCANE-SHOWCASE-QA.md` records actual checks and limitations. `tools/theme/README.md` documents asset regeneration and isolated outage fixtures. Exact image prompts and asset provenance live beside those tools. No user's media posters are bundled.

Run `npm run theme:test`, `npm run build`, `npm run build:webos`, `npm run server:typecheck` and the required `npm run server:test` before pushing. Automated theme tests cover clock boundaries and request deadlines/cancellation, not visual quality or every Finesse function. Physical phones/foldables, controller/TV hardware, screen-reader output, measured contrast and sustained device GPU performance remain release-review work.
