# Arcane Table — full app production plan

**Controlling interaction plan:** [ARCANE-TABLETOP-INTERACTION-PLAN.md](ARCANE-TABLETOP-INTERACTION-PLAN.md), updated after the user's full-screen desk clarification. The viewport must be the desk, with all navigation/content on the mat and card details summoned through the orb. Existing banner/wrapper work is transitional and does not satisfy this requirement.

Scope expanded by the user on 2 November 2026: every Finesse page, physical trinket navigation/actions, original generated artwork supplemented with Blender geometry, shared lighting and complementary particles. This supersedes the earlier Movies/Shows-only layout boundary. Default theme and all existing functions remain available. Keep working in the existing optional preview branch; no merge/deploy.

## Route coverage and acceptance

Coverage is not proved by a global color rule or banner. Each family needs a deliberate composition, working native actions, readable data/error/empty states, mobile/reduced-motion/still fallbacks and actual visual/functional review. Record framed-only pages separately from completed bespoke pages.

| Family | Routes | Intended physical experience | Current evidence |
|---|---|---|---|
| Discovery/collections | /, /dashboard, /library/:id, /browse, /libraries, /mylist, /smart/* | Hand, decks, collection folios, atlas of collections | Hand/folio implemented and exercised; remaining collection routes need bespoke review |
| Movie/show/person details | /item/:id, /person/:id, /request/movie/:id | Inspection folio, portrait dossier, acquisition contract | Item folio exercised; person/acquisition incomplete |
| Search | /search, search overlay | Scrying station with native query/results | Existing orb and styled search, full composition incomplete |
| Music | /music, /album/:id, mini/now-playing | Enchanted music box and score cabinet | Shared styling only; bespoke assets/layout incomplete |
| Games | /games, /games/game/:id, /games/play/:id, /games/stream/:id | Cartographer's adventure board and launch tokens | Bespoke work incomplete; gameplay must remain unobscured |
| Correspondence | /request, /friends, /activity, /together/*, /moments/* | Scribe desk, dispatch ledger, wax seals and memory vessels | First new family to implement |
| Workshop | /settings and every settings panel, /add-media, /remote | Artificer workbench, labelled tools and tuning controls | Themes controls work; other panels need full pass |
| Entry | /login, /invite/:code, /setup and nested steps | Welcoming archive gate and onboarding folio | Bespoke work incomplete; no actual setup changes during review |
| Playback | /play/:id and player menus/errors | Restrained themed control tokens/materials; pristine video/subtitles | Dedicated review incomplete |

TV remains explicitly excluded until its hardware constraints are met; /connect is TV-only. This exclusion is a documented release limitation, not evidence of universal device coverage.

## Work order

1. Candle click opens useful lighting controls, shared with Settings and preserving burn progress.
2. Build labelled physical wayfinding objects with accessible native navigation. Cover every destination, including feature/permission-dependent ones; never hide account, quick menu, notifications or admin capabilities.
3. Correspondence family: generated quiet desk artwork plus original Blender seal/quill/dispatch objects, one bounded lighting scene and restrained dust/ink effects. Preserve real requests/groups/Moments/together data flows.
4. Music and games each receive their own deliberate fantasy composition and key animated Blender objects, matching the same material/lighting language.
5. Workshop, entry, search, secondary details and all overlays receive bespoke treatment. Playback uses restrained controls without decorative obstruction.
6. Drive each route and overlay at desktop/phone widths, native keyboard semantics, loading/error/empty states and relevant permission roles. Record actual tested behavior and leave external-service/hardware gaps explicit.

## Progress log

- Fullscreen/unique-object checkpoint: Home now fills the viewport and keeps Resume cards on the mat; below-mat sections and top/bottom navigation are removed there. Card taps open an in-mat orb detail presentation; Back retains the mounted hand and restores its card focus. Direct title entry waits for the background mat and isolates newly loaded background controls. The desk compartment has a reversible open/close timeline with retained focus through closure. Nineteen navigation functions have distinct registered artwork; eleven original Blender instruments/GLBs/stills were authored to remove repeated placeholders. See ARCANE-OBJECT-REGISTER.md for individual animation gaps. This is a draft review checkpoint on feat/arcane-table-theme, not full-theme completion. The later live-cabinet integration is documented in ARCANE-OBJECT-REGISTER.md.

- Previous goal turn: progress. Published 8dd0d40 with softer light/shadows, material grain, measured dealing, folio/title polish and browser lighting controls. GitHub CI passed (41411270857). This does not complete the expanded objective.
- Current phase: route inventory complete; implementing candle lighting panel and the correspondence/navigation foundation. No full-app completion claim.
- Usage-limit handoff: candle click now opens the shared lighting Sheet; slider/reset, Escape close and focus return were exercised in the live browser. The original generated scribe desk is saved with its exact prompt, plus editable Blender dispatch/rings/memory-vessel/wax-signet sources, GLBs and stills. Correspondence wrappers cover requests/friends/activity/together/Moments; trinket nav and wax request actions are implemented. Desktop requests/search and the read-only quality dialog were exercised; no request or download change was submitted in this phase.
- Latest published checkpoint remains 8dd0d40. The full-app foundation is LOCAL AND UNCOMMITTED, not yet pushed. Earlier local full-app web/TV builds, 17 theme tests and server type-check passed; subsequent navigation/idle/style edits need a final build and responsive/interaction review before committing. Do not describe this as a finished or fully verified app theme.
- Immediate next actions: close the read-only quality dialog if still open, test correspondence trinket links and candle panel at 320/768/desktop widths; inspect motion-off/live-off/context-loss/idle; verify default theme and TV asset exclusion. Update provenance/creator docs and tour for all new assets. Run required checks, commit/push the existing draft and verify CI. Then continue bespoke music/games/workshop/entry/search/player work from the route table above. Current desktop Music/Games nav uses the generic deck still and needs distinct assets, not a completion claim.
