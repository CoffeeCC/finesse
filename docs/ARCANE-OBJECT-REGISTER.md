# Arcane object register

This register implements the user's rule: every unrelated function needs its own recognizable trinket. No generic book/coin/deck fallback. Repeating the same destination across screens keeps its object identity; it must not acquire a different meaning elsewhere. New unrelated destinations require a new object. `src/lib/arcaneTrinkets.ts` owns navigation identities, with a duplicate-asset and route-coverage check in `tools/theme/trinket-identity.test.mjs`.

## Navigation instruments

| Function | Exclusive object | Intended signature motion | Actual status |
| --- | --- | --- | --- |
| Home / return to table | Carved home waystone | Rune traces and gathers light | Live cabinet model; first motion/material response implemented |
| Search | Scrying orb | Internal vortex tightens, brightens, reveals writing | Existing live orb; title projection still/effects |
| Movies | Movie library deck box | Hinged lid and packet lift | Existing live object |
| Shows | Series library deck box | Its own lid and packet lift | Existing live object, distinct artwork |
| All libraries | Archive chest | Lid opens over a recessed archive | Live cabinet model; first motion/material response implemented |
| Saved stories | Personal codex | Clasp releases, cover/page moves | Live Home and cabinet codex with the same function identity |
| Anime | Carved fox mask | Fine eye/forehead inlays illuminate | Live cabinet model with inlay response; finer asset polish needed |
| Music | Seven-string lyre | Strings vibrate after a restrained pluck | Live cabinet model; first motion/material response implemented |
| Games | Numbered obsidian d20 | Short physically coherent roll and settle | Live cabinet model; first motion/material response implemented |
| Groups | Linked bronze rings | Rings resonate without separating | Existing new correspondence live motion |
| Collections | Collection folio | Leaves turn around the binding | Live folio and cabinet model; initial leaf response |
| Watch together | Gathering brazier | Embers gather inward, then lift | Live cabinet model; first motion/material response implemented |
| Moments | Stoppered memory vessel | Stopper lifts, memories swirl inside | Existing new correspondence live motion |
| Smart collections | Suspended oracle prism | Prism turns, throws a bounded refracted glint | Live cabinet model; first motion/material response implemented |
| Requests / downloads | Sealed dispatch and stamp | Stamp lifts, seals the letter | Existing new correspondence live motion |
| Activity | Chronicle hourglass | Sand flows; a deliberate turn reveals history | Live cabinet model; first motion/material response implemented |
| Settings / account | Artificer's armillary | Rings rotate on independent axes | Live cabinet model; first motion/material response implemented |
| Remote control | Crystal command wand | Crystal sends a short directional arc | Live cabinet model; first motion/material response implemented |
| Desk compartment | Turned bronze key and desk latch | Key turns; hinged desktop opens and closes | Live Blender key/lock/bolt/lid; reversible camera/sound sequence under final review |

## Existing and required action objects

The candle is exclusively for lighting/atmosphere; the sun/moon coin is exclusively for its coin flip; the draw stack is exclusively for dealing. The same wax signet must not become Settings, Close, Requests, and an unrelated menu. Those reused placeholders have been removed from desk navigation. The remaining request-confirmation signet belongs to dispatch confirmation.

Title details still need exclusive launch, bookmark/list, favorite, trailer, quality/version, share, chapter/season and cast objects. Their existing controls remain functional but do not meet the final theme requirement. Search, all collection filters, social/admin forms, confirmations and player controls need a function inventory before assigning final objects; don't relabel another trinket to fill a gap. Multiple custom libraries also require deliberate distinct identities rather than cloning the same generic chest.

## Compartment animation acceptance

- Every drawer opens along runners; every lid rotates about its actual hinge. Contents stay in the proper physical space.
- Opening and closing are both authored; closing must not immediately unmount the scene.
- Repeat/interrupt/reverse input retains position and momentum where appropriate. Navigation never waits for a decorative animation to finish.
- Focus enters the interior, stays within its tools, and returns to the opening object after closing. Back closes the active compartment before navigating away.
- Reduced motion provides the same complete function without movement. Native 44px hit regions remain larger than small visible instruments where needed.
- Opening sounds, changing shadow/occlusion and interior light belong to the final Blender/live-scene pass. Physical Blender mechanisms and initial camera/sound integration now exist; final artistic/device review remains required.

## Verification at published checkpoint 6f6fb60

At this checkpoint: 21 theme checks pass; opening and delayed closure/focus return were exercised at 320px. Desktop and narrow-phone full-viewport Home and orb title presentation were visually inspected, including direct title reload and no document overflow. The new compartment was inspected at 320px, 689px and 1440px; all 13 visible destinations have distinct registered identities. Web/TV builds and server type-check passed with the new registry, and the TV output contains no Arcane/Three/model assets. Windows full server tests reproduce existing path/config/backup failures and were stopped after stalling; do not report them as passed. The live cabinet was additionally exercised at 390px, including scrolling its lower tools and closing back to one remaining table canvas. Live-3D-off uses all distinct stills with zero canvases; reduced motion keeps navigation and immediate close/focus return. Live 3D and normal motion were restored afterward. No physical controller, dual-screen device, screen-reader or completed full-route audit has been performed in this phase.


## Live cabinet integration checkpoint

ArcaneDeskInstruments.tsx now loads the registered models into one temporary foreground canvas. It fits them to their native link anchors, clips the render to the scrolling instrument area, supplies candle-derived warm lighting and a cool environment, and releases its renderer/models/materials on close. Static art remains when live 3D is disabled or a model/context fails. The main table retains its last frame while the cabinet is open.

Current responses are a first pass: chest hinge, codex cover, lyre-string vibration, die anticipation tilt (not a completed physical roll), linked-ring resonance, folio leaf, memory stopper and shader core, stamp lift, rotating prism, independent armillary ring response, ember movement, a sand-thread pulse (not simulated sand conservation), wand/mask inlay light. They still need artistic tuning, sound/particle signatures and performance review; the new modeled desk/lid/interior is implemented but still being reviewed.


## Physical desk and lighting drawer checkpoint — current local work

The desk has wide/portrait articulated Blender sources, original generated embroidered velvet lining, live lock/key/bolt/hinge motion and a controlled camera approach. The candle now opens a separate green-baize lighting drawer on runners. Its camera approaches the front tray; the desk lid stays closed. Hardware cues have distinct key, lock, hinge, runner and tuning-fork synthesis, with voice cancellation on reversal and existing mute/volume/media guards.

New exclusive action objects: **lighting reset → tuning fork**; **lighting drawer close → brass drawer pull**. Scene brightness uses a brass iris knob; light strength uses a crystal slider. These are native accessible controls with physical presentation. The Home drawer replaces the former ordinary candle Sheet; folio/correspondence lighting sheets still need migration.

Blender channel assertions verify key travel/turn, lid opening and drawer runner travel. `desk_layout.py` derives fallback surface/hit regions from actual source cameras. Web timelines are reversible normalized interactions rather than playback of a prerendered video. Primary readiness is bounded; optional prop loads stream separately and late readiness must not replay a completed transition. The first failed cold capture is retained as evidence; the corrected phone capture shows the whole mechanism and stays at its final pose.

Whole-app completion is still unproven: most collection controls, secondary routes, entry/admin/player surfaces, individual asset polish and physical-device/controller/foldable checks remain required.

Current automated evidence: 27 theme checks pass; web and TV builds and server type-check pass. TV output has no desk mechanism, WebGL renderer, GLB or new artwork assets. Windows full server tests reproduce the existing music/path/config/backup failures and stall; the run was stopped rather than reported as passed. The tour scene has been updated and syntax-checked, not filmed end to end.

Browser evidence in this checkpoint: live desk and distinct lighting drawer at 390px, illustrated zero-canvas fallback at 320px (no horizontal overflow), and a wide 1440px live desk. The brightness dial was incremented 100→105 and the tuning fork restored 100. Both controls and reset fit the 390px drawer without scrolling. A closing drawer was reversed through its native handle and settled at progress 1. Closing releases the temporary canvas and restores focus; reduced-motion close removes the dialog immediately and returns focus to the key. Live 3D and normal motion were restored. Wide instruments were enlarged and capped at five columns after the visual review found excess empty space.

Final real UI frames/timestamps and silent clips are outside the repository in outputs/arcane-mechanisms: desk-open-phone-final (95 frames), drawer-open-phone-final (80 frames), desk-opening-phone.mp4, drawer-opening-phone.mp4, desk-wide-final.png and lighting-drawer-phone-final.png. The clips are silent visual evidence; synthesized sounds have automated mute/volume/media, bounded voice and reversal cancellation checks, but these are not recordings or an independent listening review. The initial failed cold capture and intermediate v2 remain as diagnostic evidence.

Physical controller, foldable hardware, real mobile GPU performance, screen-reader and all-route audits remain outstanding. No full-theme completion is claimed.

## Collection workspace — current local review work after 05c8e5d

The published keyed-desk checkpoint is 05c8e5d; its GitHub CI passed. The newer collection work below has not yet been published. Movie/show libraries now register a full-viewport workspace, retain their server pagination/query/genre/watch/sort models, and summon title details in one activation. The originating collection survives behind the orb; filters and leaf return with it. Related-title links retain that origin and a bounded return depth. Capture the opener before making its background inert: this fixes the browser clearing focus to body before the dialog could remember the card.

Five new exclusive collection instruments extend the desk identities:

| Function | Original object | Current response |
| --- | --- | --- |
| Search within this collection | Silver ink quill and inkwell | Quill inclination and a dry nib sound |
| Genre filters | Three tincture vials in a walnut rack | Stoppers lift with a restrained glass sound |
| Watched/in-progress/favorite filtering | Moon-heart lantern | Handle movement and a quiet metal/breath cue |
| Collection ordering | Graduated brass sextant | Index arm sweeps with a ratchet cue |
| Clear collection filters | Mineral eraser in an engraved cradle | Handle response and a soft brushing cue |

All five have original editable Blender scenes, GLBs and matching transparent stills. Index pages use native writing/radio/checkbox semantics, replacing the former dropdown menu components. Page corners turn the collection; an input in the binding preserves direct leaf access. The 390px composition fits all six cards and five instruments, with a purpose-made generated single-leaf portrait journal. The original portrait plate is packed into an articulated Blender journal. Both narrow and wide books and card frames now share live candle/orb lighting with their instruments; matching native art remains the fallback. Real mobile GPU performance is not established.

Saved-story requests moved into the folio's dispatch ledger rather than remaining below the mat. Pause/resume uses a brass escapement, retry uses a courier horn, and two-step cancellation uses forged shears. These three exclusive identities bring the registry to 29. Their editable Blender scenes, GLBs and stills share the collection light space; scroll clipping and removal release their models. This does not complete the broader acquisition redesign. The library hub, global search, secondary routes, detail action controls, entry/admin/player and other overlays still require full migration. The scene-layout registration is viewport ownership, not a completed persistent scene coordinator.


## Collection and dispatch verification — 4 November 2026

A one-card, deliberately long-title/no-art library and an isolated disposable download queue were driven through the actual browser. Pause/resume preserved action focus; retry removed the failed queue entry with blocklisting before issuing MoviesSearch; cancellation required its second activation and expired safely after four seconds. Confirmed cancellation removed the disposable entry without blocklisting and returned focus to the book after the row disappeared. No real download queue was changed. Event evidence is retained outside the public repository in outputs/arcane-mechanisms/dispatch-events-*.json.

The 320px real library shows six live-lit cards without horizontal overflow. Portrait hinge geometry now rises above the book instead of intersecting it, with a matching blue underleaf. Long missing-art labels are clipped within their card and remain fully available through the accessible name. Fresh keyboard summon/return restores the saved card's focus. Cold title reload follows replacement loading hosts rather than leaving an invisible portal attached to a disconnected book. These are browser checks, not physical-device/controller/screen-reader certification.

Final local checks for this collection checkpoint: 33 theme checks, web/TV builds, server type-check and tour/fixture syntax checks pass. TV contains no collection/dispatch model assets or Three renderer. Windows full server tests were rerun and reproduced music, path/config and backup failures, then stalled and were stopped; the local server suite is not a pass. The reduced-motion/3D-off saved ledger was driven at 1440px with zero canvases; Escape returned focus to Dispatches. Live objects and normal motion were restored.


## Library vault and fortune lots — current work after fc31aad

The full collection/dispatch checkpoint fc31aad is published to draft PR #34 and its GitHub CI passed (run 41874310480). The next local workspace replaces the libraries hub's ordinary tiles and buttons with live movie/show deck boxes on the full mat, personal codex, dispatch seal and a unique bowl of ivory fortune lots. Other destinations remain reachable through the keyed desk and retain their existing permission gates. Six-library shelves bound the number of live models; larger libraries can turn shelves. The registry now has 30 exclusive identities.

The original fortune-lots Blender scene has a continuous hollow bronze vessel, chased rim, moonstones, seven individual ivory lots with cut/inlaid runes and named pivots. Hover/focus lifts the lots; while waiting for a story they rattle. Their bounded original synthesized sound follows the same mute/volume/media guards. The existing unwatched-first Surprise query remains authoritative; a missing/offline result now has visible recovery guidance in the vault. Pending queries are aborted when leaving their owner, preventing a late random title from navigating away from a new page.

The archive chest was rebuilt as v2, with a real hollow cavity, distinct bottle-green suede interior, walnut walls, rolled hinges, chased rails, corner guards, lock escutcheon, leather lid and compass inlay. Every lid fitting belongs to the hinge assembly. Runtime and matching open/closed stills derive from the packed editable Blender scene. This improves an older simplified prop; individual artistic tuning remains ongoing.

Real browser checks so far: the vault opens the Shows folio (210 titles), fortune selection opens a real title over its originating vault, and return restores keyboard focus to the fortune bowl. Phone 390px composition was visually inspected, corrected for heading/orb-label crowding, and saved outside the repo. Full hardware performance, physical controller, foldable and screen-reader certification remain outstanding. The Home boxes still select discovery hands; a distinct source-selection object is required before changing their navigation.

Additional vault checks: a nine-library fixture displayed six boxes on shelf one and three on shelf two at 320px, with no horizontal overflow and one remaining canvas. Turning the shelf focused its first new deck and replaced the old shelf models. The vault key opens the actual desk to progress 1; closing leaves one canvas and restores focus to the key. The collection checkpoint CI is green; this newer vault checkpoint still awaits publication.

6 November verification continuation: the disposable fixture now uses THEME_FIXTURE_STATE outside the watched source tree during state transitions. A no-title fortune displayed actionable guidance and kept focus on its bowl. A never-answering request recovered through the 15-second deadline; leaving during a three-second delayed answer stayed on Home after that answer would have arrived. The failed vault recovered through its actual retry object and focused the first recovered library. An empty archive retained Home/search/key/personal navigation and a readable explanation. No external service or production queue was mutated.

The 320px 3D-off/reduced-motion vault was visually inspected with six libraries, zero canvases and no overflow; turning shelves moved focus to the first new deck. The first fallback pass exposed oversized transparent margins in the original box stills. An SVG viewport now frames their verified alpha bounds without modifying the artwork. Live objects and normal motion were restored. Sounds are implemented and policy-tested, but no independent listening review or audio recording is claimed.

Vault checkpoint final local checks: web and TV builds, server type-check, 33 theme checks and tour/fixture syntax checks pass. The Windows server suite was rerun on 6 November, reproduced its existing music/path/config/backup failures and stalled; it was stopped and is not a pass. No server production code changed. The 1440px live six-library vault was visually inspected; the still/GPU modes, 320/390px layouts and nine-library shelves have evidence outside the repo. Full-route coverage and physical-device performance remain unverified.
