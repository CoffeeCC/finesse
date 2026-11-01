# Arcane showcase verification

1 November 2026. Covers the expanded optional theme, not an assertion that every Finesse integration or physical device was retested. No release/merge is implied.

## Exercised against a real server

Local Vite web app proxied to the user's Finesse test server, with the existing member test profile. Browser UI driven through the desktop browser tools; no camera/microphone requested.

- Home: live hand, card selection, box selection/dealing and title links. One shared scene canvas; five resting cards on desktop, three visible on phone.
- Full collection: actual 700-movie catalogue; direct last leaf 117 reached the final four titles. Six-card leaves use server offsets, not a fixed initial batch.
- Search: Arrival reduced the collection to one title. Sorting by Recently added and filtering Fantasy produced 206 matching movies. Paging to leaf 2 retained both controls. Selecting Gremlins, opening its title and using browser Back restored genre, sort, leaf and selected card in the URL/UI.
- My List: added Arrival from title details, verified its card in the saved folio, reopened it, removed it and verified the empty folio. Test list restored to its original empty state. Requests/downloads navigation retained.
- Title inspection: original Play, My List, favorite, preview, cast-device and More controls remain. Desktop and phone compositions visually inspected. Actual playback routes are retained; this pass did not certify every playback format, subtitle track or external device.
- Responsive UI: 320×740, 390×844, 768×1024 and desktop browser viewports. Phone is collection-first, with two columns; inspection opens the existing Sheet and Open story navigates correctly. Back retains selection. No horizontal document overflow in the inspected phone states. Resizing retains selected card/filter state.
- Reload after navigating away from the development theme link retains Arcane and its preview opt-in.
- Last-leaf → another library resets to leaf 1. Route parameters now own leaf/selection directly. Initial library loading no longer flashes the standard grid before the folio.
- Live 3D objects off leaves zero scene canvases and usable art. Reduced motion retains a steady live scene with animations disabled. Restore Finesse returns the standard Home and removes Arcane scene components. Original preferences restored afterward.

## Lighting, animation and fallback

- One shared Three.js canvas draws candle, orb, boxes, receiving desk and enhanced cards; desktop folio inspection showed seven live cards (six slots plus inspector). The shared light creates model highlights and receiving shadows. Illustrated ornaments and normal DOM text are documented hybrid boundaries.
- Found/fixed: blue card backing protruding from frames, selected cards behind neighbors, untextured book strips, tablet gutter crowding, stale material checks between Three module instances, and fallback flags reappearing after context loss/resize.
- Accelerated local candle reached gutter/moonlight; UI disappeared and the desk remained with dim resting cards, a burned-down candle and faint orb. Escape relit the candle without navigating. A subsequent deliberate Search press opened Search normally.
- Focused search prevented accelerated burnout. Active player/media/dialog/menu/busy and trailer guards are implemented; clock tests prove eligibility is rechecked during gutter. This is not a timed 45-minute endurance certification.
- Genuine WEBGL_lose_context was triggered with the development lab. Native art returned, remained after resizing to phone width, and the search orb still navigated. Native controls do not depend on the scene.
- Isolated loopback fixture: a one-card library with a long name and no poster retained readable fallback/inspector; HTTP 503 and a hanging request produced the collection error with Try again. The hanging transport reached the bounded deadline. Normal fixture data was restored afterward; no real server outage was induced.
- Still-candle flame anchoring was corrected to use the sprite's actual 4:5 bounds, avoiding letterbox offsets. Wide folios are bounded to 1320 pixels; lower card captions have extra clearance from the binding.
- Blender sources regenerated successfully. A packed editable lighting study and a four-second rendered study were produced locally. That film is a Blender material study, not a screen recording of the application.

## Automated checks

- Web build and TV build passed locally on Windows.
- Theme tests: 9/9 passed (clock boundaries, eligibility/relight, deadline/cancellation).
- Server type-check passed. Tour script syntax and git whitespace checks passed.
- Production output contains no development-lab controls or accelerated candle query handling. TV output contains no Arcane scene/models/art.
- Full server tests were attempted on Windows and reported existing path/config/backup-related failures; the stalled run was stopped. No server source changed in this theme work. Do not report the local full server suite as passing. Linux CI must be checked for the pushed commit separately.
- GitHub CI passed for implementation head `fec8118` on 1 November 2026: [run 41333389968](https://github.com/CoffeeCC/finesse/actions/runs/41333389968). This includes the current 3.2.6 master baseline. The Windows failure above remains documented rather than being relabeled as a local pass.

## Remaining release review

Physical phones/foldables and sustained GPU/battery use; actual controllers/TV remotes; screen-reader output; measured contrast; all player/subtitle/device integrations; real cross-server folio browsing; unusual third-party artwork; 45-minute idle endurance and behavior with browser suspension. Viewport screenshots are not physical-device tests. Arcane remains an opt-in unfinished theme and excluded from TV.

Local screenshot/render outputs are kept outside the repository so user library artwork is not bundled as public theme assets. The production plan and author guide are the implementation handoff; this report separates exercised UI from implementation-only guards.
