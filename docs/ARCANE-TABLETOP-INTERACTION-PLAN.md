# Arcane Table — the desk is the application

User direction, 2 November 2026. This supersedes the earlier banner/wrapper approach and the Movies/Shows-only layout boundary. It is an interaction redesign of the entire application, not a decorated version of the existing page layouts.

## Non-negotiable presentation

When Finesse opens, the viewport is the desk and mat. No conventional top navigation, floating tab bar, search pill, avatar button row, ordinary footer, or standard page continuing below it. All navigation and application controls are physical objects in the tabletop world. Increasing/recomposing the mat is preferable to pushing functionality outside it.

Cards, readable inscriptions, writable parchment, record sleeves, ledgers and projected details are part of that world. They are not ordinary panels placed underneath a decorative hero. Native HTML links, buttons, inputs, sliders and dialog semantics remain underneath for reliable keyboard/touch/controller/accessibility behavior; their *visual presentation* must be the physical object or writing surface. The browser/OS keyboard and browser-owned dialogs are outside the application's artwork.

Do not implement this by hiding existing functions or by renaming a normal popup a tool tray. Every visible layer—including loading/error/empty states and secondary/admin controls—must be intentionally designed. The existing generated/Blender materials remain useful, but current correspondence wrappers, standard content ledgers and navigation variants are transitional work, not acceptable final coverage.

## Opening composition

The entire desktop viewport shows one coherent lit desk. The current ornate mat remains the main visual reference. Objects sit naturally askew with contact shadows and consistent scale. The central hand has generous room; the orb is a major object rather than a tiny icon. Persistent navigation occupies a small set of stable desk-edge stations.

| Physical object | Primary purpose |
|---|---|
| Scrying orb | Search and title/person/album/game inspection, depending on what was summoned |
| Library deck boxes | Open the actual collection folio; no separate text-only Browse full deck link |
| Draw stack + labelled library token | Deal a discovery hand; source token selects its library through a physical collection tray |
| Resume spool / small continuation hand | Continue watching/listening; progress is inscribed on its cards |
| Personal codex | Saved stories and collections; replaces the redundant Open title object |
| Wayfinder compass | Travel between media/workspaces; expands a physical atlas with labelled destination objects |
| Music box / instrument | Music and current listening session |
| Adventure map / game token | Games and game launch information |
| Sealed dispatch + wax signet | Requests, pending acquisitions and download controls |
| Linked rings | Groups, friends and shared libraries |
| Memory vessel | Moments and received memories |
| Gathering tokens | Watch-together sessions and invitations |
| Candle | Lighting adjustment, slow burn and the moonlit idle scene |
| Personal signet / portrait locket | Profile/account functions and notifications |
| Artificer's tool roll | Settings, server/admin tools, add-media and remote controls |

Not every tool is spread across the desk simultaneously. Workspaces reveal their relevant objects by opening an atlas, book, drawer or tool roll on the mat. Those are illustrated/modeled physical compositions, not generic lists in rectangular popovers. Labels remain clear: fantasy styling must not make Play, Cancel, subtitles or account access a guessing game. Each object has one primary action; there are no double-tap-to-open rules or hover prerequisites.

## Card → orb → details

One click, tap or Enter on a media card opens its details. Focusing or hovering can lift/identify it; activation must not merely select it and require a second Open title action. The separate below-mat title summary, More about this title link and duplicate Open title control are removed once the orb flow carries their functions.

1. **Intent, immediately:** start fetching the real title and commit its normal detail URL. Record the originating hand/folio, filters, leaf, selected card and focus key. A direct detail URL initializes the same orb presentation without requiring a preceding card click.
2. **Gather, roughly 0–180ms:** the chosen card rises slightly and catches a restrained highlight. Other cards settle back; they do not scatter or disappear unpredictably.
3. **Summon, roughly 180–500ms:** a narrow ribbon of motes/ink-like light travels toward the orb. Its internal threads tighten and brighten. The effect is tied to that orb's light source, with no whole-screen flash.
4. **Approach, roughly 250–650ms:** a short controlled camera dolly/pan brings the orb and its reading area forward. No orbiting camera, spin, dramatic shake or simulated walking. Keep the horizon stable.
5. **Reveal, roughly 450–850ms:** details unfurl out of the orb as a luminous, readable folio/projection over the mat. The orb remains visibly connected to the presentation. Real text, images and controls are layered into the physical composition, not rasterized into inaccessible artwork.
6. **Interact:** Play/Resume uses a distinct launch token; episodes appear as chapter cards; versions/quality use a prism/lens tray; cast use portrait cards; My List uses the personal codex; favorites use a small charm; sharing/parties/Moments reveal the relevant physical tools. All current options remain reachable.
7. **Return:** Back or a clearly labelled return talisman folds the projection into the orb, reverses the camera approach and restores the originating collection state and focus. Returning does not re-deal the hand.

Fetch and animation run concurrently. Never wait for the animation before requesting data, or keep a long animation running to conceal failure. A slow response leaves a quiet, actionable summoning state in the orb. Failure becomes an in-world readable message with a retry object and return talisman. Repeated activation is bounded; Back cancels the transition and stale results cannot replace a newer selection. Navigation and playback are never delayed for decorative completion.

## Whole workspaces, not page headers

**Collections:** a real open collection folio occupies the mat. Filter/search/sort controls become dividers, writable index parchment and labelled sorting objects. Leaf controls are physical page corners/tabs with full native hit targets. Every server page remains reachable. The library boxes and personal codex are the routes into these books.

**Requests and downloads:** an acquisitions folio occupies the mat; discovery sets are its dividers and every title is reachable through its leaves. Search is written into an index strip. Requests use wax signets; pending items are sealed dispatches; downloads are dispatch cards with progress threads and clear status inscriptions. Retry, pause/resume, cancellation, quality choices, artist albums/EPs and failure explanations all receive deliberate objects or physical document controls. No ordinary queue section appears below the desk. Destructive confirmation remains explicit, using a latch/two-step seal rather than removing the confirmation.

**Music:** music box, score cabinet and record/sleeve cards. Album/artist details emerge from the orb. Playback, shuffle/repeat, queues, lyrics, volume, casting and remote sessions are integrated tools on the mat, not the existing mini-player pasted on top. Track names/times remain easy to scan.

**Games:** an adventure atlas, game cards and launch tokens. Game configuration, streaming/pairing/readiness/error states use the same workbench language. Actual gameplay is an unobstructed viewing aperture; theme effects never consume game input or cover the game.

**Groups, Moments, together and activity:** correspondence/memory objects open their actual content on the mat. Shared-server state, invitations, received messages, queues and activity are designed pages within the desk world. No existing friend/notification/menu sheet is left with normal app styling.

**Settings/admin:** the tool roll opens an artificer's workbench with labelled tools for lighting, sound, playback, libraries, downloads, connections, groups, access/security, server maintenance and updates. Dense settings use readable physical ledgers and tactile controls; not every option needs a separate large model. Writable fields, toggles, selectors, ranges, help and dangerous confirmations must each have a designed equivalent. Preserve permission/feature gates and all validation.

**Entry/setup:** login, profile selection, invite, setup steps, setup errors and resume states use an archive-entry/tabletop presentation. Do not perform real setup mutations merely to review the artwork. Account identity and error recovery remain clear.

**Playback:** the orb becomes a viewing aperture on the mat. Physical controls reveal when requested and recede during playback. Video, subtitles and aspect ratio retain their source colors and legibility. Fullscreen may fade the desk out for unobstructed media, but never falls back to the ordinary Finesse player controls.

## Responsive composition

Desktop uses a wide mat. Tablets/unfolded screens use a shallower hand and adjacent reading folio. On narrow phones, the desk is recomposed: fewer large objects in the active workspace, a stable reachable return/travel talisman, and a vertically readable folio *on the continuous mat*. Do not shrink the desktop screenshot until targets/text are unusable. No normal bottom tab bar is retained as the mobile escape hatch.

The orb reveal on phones uses a short local approach and a reading folio filling the usable mat; it does not require a long camera trip. Long text, forms and lists scroll within their physical document or along a continuous tabletop—not into an unrelated page below a bounded decorative image. Controls remain at least 44px, safe-area-aware, with no hover dependency. Folding/resize retains route, form, selection and reading state. Where a hinge separates panes, objects and important text must not straddle it; device support must be verified rather than inferred from a wide viewport.

## Motion and lighting standard

Use original Blender geometry/pivots for key objects, generated art for high-detail surfaces/ornament, and native text/control layers. One persistent scene owns the desk, receiving surfaces, material light and particles. Do not add independent canvases whose lights falsely appear to be shared. Hover changes only artwork; native hit regions stay stable. Explicit workspace camera motion moves projected UI and objects together, with interruptible transitions and usable Back.

The dispatch stamp lifts with weight and settles without moving the letter. Linked rings tilt while staying physically connected. The vessel's inner constellation responds to focus/hover, with a controlled stopper turn and localized glow. Avoid applying one generic floating animation to every trinket. Particle budgets are bounded, localized and short-lived; no endless fireworks or unsolicited ambient sound. Existing volume/mute/media/hidden-tab guards apply.

Reduced motion presents the same physical compositions with immediate focus/reveal and steady light. 3D-off/WebGL-loss uses matching in-world art, readable documents and usable objects—not the ordinary app UI. Rendering/particles pause when hidden; cap pixel ratio/frame rate and mobile shadows. Candle clock, idle eligibility, burnout, safe wake and dialog/typing/media protection remain intact across workspaces.

## Implementation sequence and gates

1. Inventory every route, nested settings panel, overlay and state in ARCANE-FULL-APP-PLAN.md; map each action to an object/document control. Mark unsupported work honestly.
2. Build the persistent full-viewport Arcane shell, scene coordinator, in-mat document/overlay root and object registry. Theme routes get dedicated compositions sharing existing query/action models; do not mount unchanged standard pages below a themed header. Default Finesse retains its current layouts and does not download Arcane assets.
3. Complete the opening mat: remove all out-of-world navigation/footer/summary/resume sections, place their functions on the mat, implement one-tap card inspection through the orb and reversible routing/focus.
4. Finish collection and acquisition workspaces end to end, including content, lower sections, filters, queues, dialogs and every error/empty/loading state. Drive real browsing and read-only dialogs; use an isolated fixture for destructive mutations/failure cases.
5. Complete music/games, correspondence, workbench/admin, entry/setup, search/secondary details and playback using the same contracts. Update source authoring guidance and asset provenance.
6. Audit at desktop/tablet/phone widths, reduced motion, live-off/context loss, keyboard/touch/controller behavior, nested routes/Back, permissions, data errors and media safety. Run web/TV builds, theme/server checks and CI before pushing review checkpoints. Hardware/performance/accessibility checks need real evidence; TV remains excluded until its own review is met.

Acceptance is full-route/full-state coverage: scroll every page to its end, open every tool/overlay, inspect loading/error/empty states, and verify that no ordinary Finesse chrome, button skin, menu, form panel or below-mat section remains visible in Arcane. Green unit tests alone cannot prove this. Do not mark the full theme complete until this audit passes.

## Current checkpoint

The current code is still a transitional prototype. Home now fills the viewport without the navbar, bottom tabs or below-mat summary/resume/footer. Continue Watching is a small real card hand on the mat. A wax latch opens a perspective-animated desk compartment holding labelled destination objects. Card activation routes to title details in a focus-trapped orb presentation, retaining the mounted home hand underneath. The title model and actions are reused, so the existing ordinary action/section controls still need bespoke object designs. The projection currently uses an illuminated orb still above the shared background scene, not a second live 3D orb renderer.

Candle lighting Sheet works; correspondence artwork/Blender assets and initial trinket navigation exist; dispatch/rings/vessel use distinct damped hover motion with frame-rate and interruption checks. Standard controls and below-header page layouts remain on other routes. The unused acquisition-ledger draft was removed; transitional wrappers must not be treated as completed pages. This expanded checkpoint is review work on feat/arcane-table-theme after 8dd0d40, not a finished release. This document is the design target, not a claim that the target has been built.

### Hinged desk and scale direction

### Binding requirements from the user

- Every function/destination has a unique, recognizable trinket. Do not reuse books, coins, deck boxes, seals or other objects for unrelated destinations. The same function may retain its identity across views; changing the label on a reused prop does not create a new trinket.
- Every drawer and desk compartment has authored opening **and closing** motion: drawers travel on their runners, lids rotate around their hinges, and contents remain attached to the correct interior. No instantaneous appearance/disappearance or generic panel fade as the final treatment.
- Key assets have deliberate animations, with bounded particles and appropriate lighting. Reversing or interrupting an interaction must preserve continuity; reduced motion retains the function without requiring movement.
- The entire opening screen is the desk/mat. No standard navbar, footer, conventional menus or below-mat page sections. All routes and actions must eventually receive the same treatment.
- Media card activation summons details from the orb, retaining route/Back behavior, selection and focus.
- Mobile, foldables/dual-screen layouts, readable labels, generous hit regions and coherent physical scale remain required. Foldable-specific behavior and physical-controller validation are still outstanding.
- Dark celestial/high fantasy art direction; original generated artwork complemented by Blender assets. Premium quality is the acceptance bar, not functional completeness alone.

The current hinge prototype animates opening and closing through a reversible Web Animations timeline, retains the dialog during closure, and restores focus after closing. This was exercised in the browser at 320px. Motion can reverse without replacing the animation. A dedicated Blender interior/lid and a visual review of interrupted motion remain required for the showcase.

The companion [object register](ARCANE-OBJECT-REGISTER.md) tracks unique identities, intended animation and actual implementation status. New navigation instruments have Blender sources/GLBs/stills. The compartment now loads live models into one bounded foreground scene with shared candle-derived lighting, shadows and distinct first-pass responses. The background table retains its last rendered frame while the cabinet is open. Stills remain the fallback when live 3D is off or unavailable. Successful integration is not a claim of final asset/animation polish.

The art direction is **dark celestial fantasy / an arcane collector's desk**. The user approved a desktop that opens like the library deck boxes, plus drawers where useful. Use the main mat for the browsing hand, library boxes, candle and orb; reserve the deeper interior for correspondence, account/workshop and secondary tools. Opening must read as a real hinged surface exposing a recessed cabinet, with reversible motion, bounded travel and native focus/Back behavior. The current CSS lid is an interaction prototype; the showcase needs an original Blender desk/lid model and complementary interior artwork before this is called finished.

Maintain one physical scale hierarchy: the orb should be larger than the candle body, books and deck boxes should plausibly hold the same cards, and seals/coins should remain smaller handheld objects. Hit areas can exceed visible geometry. Do a dedicated desktop/phone scale pass after the compartment composition settles; never shrink every tool to fit a crowded top strip. Mobile should reveal compartments as focused in-mat scenes with readable labels and 44px minimum touch targets. Distinct Music/Games/workshop objects are still missing; temporary shared book/coin stand-ins are not final art.
