# Arcane Table — current implementation

Updated 31 October 2026. Applies to the optional-theme branch based on Finesse 3.2.5, not a public release.

## Visual direction

The active theme is the approved celestial fantasy table: midnight-blue hide, sculpted bronze card frames, dark carved wood, and stone trim. The table, phone background, transparent frame and deck back are separate raster assets generated with the built-in image-generation tool. The orb and library boxes are Blender models. Real library posters remain live images; the generated concept is not the app background.

Earlier violet-table and decorative dice/rune/coin experiments are not part of this included theme.

## Live Blender orb

Search is an accessible native button whose artwork is an actual 3D scene. tools/theme/create-scrying-orb.py creates the bronze pedestal, claws, relief, crystal shell and constellation geometry, exports src/assets/card-table/scrying-orb-v1.glb and saves tools/theme/scenes/scrying-orb-v1.blend. It also renders scrying-orb-still-v1.webp as the fallback.

ScryingOrb.tsx loads Three.js and the GLB on demand. Runtime materials, environment reflections, warm key light, cool rim light and an animated internal point light illuminate the model. An animated noise shader and drifting star points provide the swirling core. This is a hybrid scene: the orb and library boxes are live 3D; the board, frames and draw pile are rendered images. Live light affects the models, not the baked table image. This is not path-traced global illumination in the browser.

The renderer caps pixel ratio at 1.5 and updates at roughly 30 frames per second. It pauses offscreen and in a hidden tab, releases resources on unmount, and falls back to the still if loading or WebGL initialization fails. Context loss returns to the still. TV, system reduced motion, Animations off and the Live 3D objects preference use the still. Hover/focus gently increases the orb's internal energy. Search works with either representation; TV uses its search page rather than the desktop overlay.

Regenerate with the installed Blender executable:

    blender --background --python tools/theme/create-scrying-orb.py

The Blender scene and runtime shader are complementary sources. Editing procedural Blender materials does not automatically export their node graphs to glTF or update the runtime shader. Update and verify both representations.

## Library boxes and interaction effects

tools/theme/create-deck-trinkets.py generates separate sun/amber movie and moon/blue show boxes, each with an editable .blend, self-contained GLB and matching transparent still. DeckTrinket.tsx animates a named LidPivot and CardLift: the lid opens on pointer hover or keyboard focus, revealing and lifting the cards, then closes on leaving and blurring. A busy selected deck opens during dealing, with restrained particles and stronger ward light. Lights, reflections and receiving shadow geometry are live in each model scene.

The first two library boxes render live to bound the scene to three WebGL contexts including the orb; additional libraries use their matching still. All stills remain fully clickable. Each box updates at about 24 fps with pixel ratio capped at 1.25; rendering pauses offscreen or in hidden tabs and resources are disposed on unmount. Shared Live 3D objects, reduced motion and Animations off select stills. The TV build aliases both live components to static replacements, excluding Three.js.

The draw pile has a hover/keyboard-focus riffle and top-card lift only while idle. Leaving settles the stack; shuffling/dealing retains its own animation. Selected card crests have a brief one-time catchlight, and the title changes with a short fade. Reduced motion and Animations off suppress these effects. The draw pile is not a live 3D model.

## Browsing and navigation

Movies and Shows deck boxes select actual accessible libraries. Five live titles form a hand on desktop. Phones show the selected title and two neighbors, with previous/next controls reaching every card. Open title navigates to the existing title page. The stock and Deal again collect, shuffle and deal actual random results; repeats are possible. Loading completion controls the reveal, with cancellation, a deadline and Retry.

Object hit targets remain stationary while artwork moves. The whole hand has space inside the rim. Card details and full title remain below the scene. Continue Watching retains real Resume links. Full Finesse Home opens /dashboard. Standard navigation remains on other routes; the table Home replaces the desktop Main menu with its labelled objects. Quick menu, account, Moments and mobile navigation remain available.

## Themes settings

Settings now has a dedicated Themes section. It includes built-in choices, immediate selection, Try your theme, Restore Finesse, the Live 3D objects switch for Arcane Table and a downloadable creator guide. Accent and display controls remain in Appearance. Themes and 3D preferences are browser-local, with storage-event synchronization between same-origin tabs. A local development link ending ?theme=card-table selects that theme explicitly; production does not honor this development shortcut.

Theme selection uses src/lib/theme.ts. Shared palettes use themes.css; scene overrides use celestial-table.css after the legacy card-table.css. The three built-in IDs remain default, midnight and card-table. No theme ZIP importer, visual editor, gallery, account sync, custom script loader or foldable-aware renderer is implemented.

## Community authoring

Read THEME-AUTHORING.md for the usable source contribution guide. Read THEME-SYSTEM-PLAN.md for the dedicated settings direction and remaining pack system work. FOLDABLES-AND-THEME-PACKS.md describes proposals, not shipped capabilities.

## Validation

Run npm run theme:test, npm run build and npm run build:webos. Before pushing, AGENTS.md also requires server:typecheck and server:test. Existing automated theme tests cover request deadlines/cancellation ; they do not prove 3D quality or the complete UI. Exercise Search, Escape/focus return, library switching, deal, title navigation, phone paging, Themes selection/reset, 3D toggle and reduced motion manually.

Physical phones, foldables, TV remotes/controllers, screen-reader output and measured contrast need separate verification. Do not infer device certification from resized screenshots or a passing TV build. Runtime raster art is encoded as WebP. Physical-device performance and accessibility checks remain release-review tasks; see the pull request validation notes.
