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

- Prior goal turn: **progress**. Published 6f6fb60 to draft PR #34; its GitHub checks passed. Fullscreen Home, routed orb details, unique navigation instruments and their first live responses are present. This was not full-theme completion.
- Current mechanism phase: original articulated desk/lock/key and sliding lighting drawer, separate wide/portrait scenes and reference cameras, new embroidered lining artwork, native surface layouts derived from Blender, distinct cancelable hardware sounds and a real Home candle drawer. Keyboard lighting adjustment/reset and closing focus/renderer cleanup were exercised. The first cold motion capture exposed a skipped unlock stage; primary-scene readiness and incremental prop loading corrected it, with regression coverage for late readiness replay.
- Current source includes 27 passing theme checks at the last run; later edits still require final checks. New mechanism art and code remain local until the next review commit. Full Windows server checks have reproduced existing path/config/backup failures and stalled; do not report a local full-suite pass.
- Next work: finish mechanism phone/desktop, fallback/reduced-motion and interruption verification, update tour/provenance/author guidance, run required checks and publish a draft checkpoint. Then continue the collection family on the persistent mat: actual library boxes open their folios, one-tap cards summon the orb, all collection filters/pagination become designed physical document controls, and saved requests no longer continue below the scene. Proceed through acquisition/search, music/games, correspondence, workshop/entry and player families without shrinking the goal.
- Keep [ARCANE-GOAL-CONTRACT.md](ARCANE-GOAL-CONTRACT.md) and [ARCANE-OBJECT-REGISTER.md](ARCANE-OBJECT-REGISTER.md) authoritative about requirements and gaps. Foldable-specific layouts, physical controllers, screen-reader/hardware performance and complete full-route coverage are still unverified.

### Collection continuation after 05c8e5d

Published physical desk/drawer sources and motion/sound checkpoint: 05c8e5d, GitHub CI successful. Current local movie/show/saved folios own the viewport and replace collection dropdowns with original quill/vial/lantern/sextant/eraser instruments and bound index writing. Six cards, page corners, direct leaf input, filters and sorting retain their actual data models. One activation summons the orb over the originating collection; related titles retain it, and return restores the query/leaf and card focus. A portrait journal plate replaces the distorted desktop spread on phones. Cold-entry/loading/error states are being moved onto the book as well.

Do not infer complete collection/acquisition coverage: the libraries hub remains its former layout, Home deck boxes still choose a discovery hand, saved dispatch rows now have distinct live escapement/horn/shears actions, but title details retain conventional controls. Mobile book/card frames now share live lighting; actual mobile GPU performance remains unverified. Next work must complete those actual functions, then continue every route family in the original inventory.


4 November local collection checkpoint: 29 exclusive trinket identities; original wide/portrait lit folios, five articulated index instruments and three physical dispatch actions. Browser-driven disposable queue evidence covers pause/resume/retry/confirmation expiry/cancel and focus restoration; no production queue was modified. Cold projection-host replacement, portrait hinge direction and long fallback-card labels were corrected. This remains progress toward the full inventory, not completion.
