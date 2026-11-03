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
