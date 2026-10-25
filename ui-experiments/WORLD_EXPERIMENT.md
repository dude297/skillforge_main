# Experiment: Ember and the isometric company (branch `exp/world`)

This is an isolated design experiment, built on rc1 (`a6fd80a`):
- **Routes:** lazy `#/world` (the page) and `#/world/lab` (the mascot sheet), with their own chunk (37 kB, 11.5 kB gzip) and scoped CSS.
- **Untouched:** the console, the trusted backend and the release candidate. The 29 console e2e tests still pass.

## What was built

- **Ember, an original pixel companion** (`ui/src/world/sprites.ts`):
  - **Shape:** a flame-drop "spark from the forge", on one 28×24 grid.
  - **Palette:** 7 core colours plus 3 state accents that keep the console's meanings (mint = verified by code, amber = a person is needed, coral = failure).
  - **States:** 7 animated states (idle, investigating, building, verification pending, verified, waiting for a person, error/recovery), each 3–9 frames composed from layers and rendered as run-length `<rect>`s.
  - **Reduced motion:** the first frame only; the prop still shows the state.
- **The 2.5D company** (`ui/src/world/Scene.tsx`):
  - **Construction:** plain SVG, 2:1 isometric tiles, no new dependency.
  - **Contents:** four departments (operations intake, local AI room, human review desk, skill library) plus the independent-check gate at the crossroads.
  - **Movement:** the companion walks the corridor through the hub.
  - **Interaction:** departments are focusable buttons that open an evidence popover; Escape closes it and returns focus.
- **One event adapter for three sources, never mixed** (`ui/src/world/events.ts`):
  - **Illustration:** the scroll story, labelled as such.
  - **Recorded run:** a real backend run exported through the read-only operator API (sanitized; mock agent, labelled).
  - **Live:** the same API, live. If the page isn't served by the API, Live says so and shows nothing.
  - **Honest state:** the mascot's state comes only from the last real event, or pending approvals in Live; no progress is invented.
  - **True order:** the story follows the system's real order. The brief listed verification before human approval; the system approves first, then applies, then verifies.
- **Page** (`ui/src/world/World.tsx`):
  - A hero, then an IntersectionObserver-driven scroll story with a sticky scene and spring camera framing.
  - Replay controls (play, pause, step, scrubber, arrow keys), the event log and a state legend.
  - **Mobile:** stacked cards, each with a still scene.

## Two treatments (both are the same page: `?t=daylight` and `?t=night`)

| | Daylight (warm pixel branding) | Night (premium console + pixel accents) |
|---|---|---|
| Readability for a non-technical viewer | **rooms, people, lamps and states read at a glance** | departments blur together; the low-contrast floor and walls need explanation |
| Personality | **strong**: chunky frames, hard offset shadows, a friendly companion | the mascot carries it alone |
| Fit with the console | a distinct "story" surface; shares the state colours and the mascot | **identical tokens**; feels like the same product |

**Chosen: Daylight** for the world and story surface. It wins on the two things the brief prioritises for judges, readability and personality. The console stays as it is; the shared state colours and Ember are the bridge between them.

## 3D feasibility spike (`ui-experiments/world3d`, time-boxed, isolated package)

- **What it is:** React Three Fiber with three.js: the same office, the same recorded events, and the same sprite frames (as a billboard).
- **What it isn't:** imported by the main UI. `three` lives only in this folder.

Measured with `ui/scripts/world-perf.mjs`: the same harness for both, installed Edge, hardware GPU (Intel Arc, ANGLE/D3D11). Values are medians of 3 runs on the Windows dev box; raw JSON is in `ui-experiments/perf/`.

| | 2.5D SVG (`#/world`, replay playing) | 3D R3F spike |
|---|---|---|
| JS transferred (whole page, gzip) | **134 kB** | 289 kB |
| Ready (scene drawn) | 715 ms | **347 ms** |
| JS heap | **6.6 MB** | 7.6 MB |
| Desktop fps / p95 frame | 60.2 / 17.3 ms | 60.2 / 17.0 ms |
| Main-thread busy, desktop | 26.7 % | **10 %** |
| GPU-process CPU per 6 s | **0.7 s** | 0.8 s |
| Phone width, 4× CPU throttle: fps / long frames | **53 / 9** | 50.8 / 13 |
| Reduced motion: main-thread busy | 3.7 % (animations off) | 2.1 % (render on demand) |
| Concurrent CPU workload (4 processes) slowdown | −3 to +9 % (noise) | −5 to +9 % (noise) |
| Offline (requests outside 127.0.0.1) | 0 | 0 |
| Accessibility | DOM: focusable departments, popovers, axe clean at 1440 and 390 px | canvas: no semantics; would need a parallel DOM layer |
| Comprehension | signs, a person at the desk, lamps, shelf, popovers | no labels yet; text in 3D needs more deps (drei/Html) |

**Notes:**
- An earlier 2.5D build used 24 % of the main thread, with 27 long frames on throttled mobile. Moving all motion (companion, LEDs, lamp) to an overlay SVG layer and pausing off-screen scenes fixed the mobile case.
- On a 20-core GB10, either cost is negligible next to vLLM.

## Recommendation: **keep 2.5D; don't upgrade to 3D**

- 3D matched 2.5D on smoothness and was lighter on the main thread.
- It doubles the JS, loses the DOM accessibility the console has, and needs extra dependencies before it can even say what each room is.
- It didn't make the journey easier to understand.
- If the experiment is adopted, adopt Daylight 2.5D as a separate "story" surface linked from the presenter. Keep the console as it is.

## Verify

```bash
cd ui && npm run build && npx playwright test e2e/world.spec.ts   # 6 tests: labels, keyboard, live honesty, reduced motion, axe x2
node scripts/world-tour.mjs screenshots/world daylight             # needs `npx vite preview` on :4173
cd ../ui-experiments/world3d && npm install && npm run build && npm run preview   # :4175 (spike)
```

## Final product-experience review

### 1. Narrative comprehension

This is a heuristic audit, not user data. The 3-person test is scripted in `USABILITY_TEST.md` and has **not been run**.

| concept | before | changed |
|---|---|---|
| it's a company | four room signs only | the hero names the cast in one sentence; the gate has a sign; a "How to read the office" key sits next to every scene |
| Ember is the agent | hero copy only | the key says "Ember: the AI agent"; the scene chip reads "Ember: <state>"; beat 2 says "Ember, the AI agent" |
| human approval | person, lamp, "?" bubble | the key: "Person at the desk: approves every change" |
| verification | an unlabelled gate | the gate sign; the key gives its colours (checking, verified, failed); beat 4 names "the gate" |
| skill reuse | coloured blocks on a shelf | the key gives shelf colours (skill waiting, skill in use); beat 6 explains the green block |

Known residual risks:
- Signs are small at phone width; the key and the zoomed story cards compensate.
- "Recorded run" and "mock agent" may need words a layperson recognises. That's what Task 4 of the test checks.

### 2. World → console (frontend only; no new endpoints)

| from the world | opens | provenance and identity |
|---|---|---|
| illustration (any department) | `?source=synthetic#/console/<section>` | console **Preview** |
| recorded event or department | `?source=recorded&replay=world&task=N#/console/history` | console **Recorded**: History replays the same recorded run, cut to task N |
| live event or department | `?source=live&task=N#/console/investigations` (skills/system for those rooms) | console **Live**, with task N selected |

Console changes:
- `LiveInvestigations` honours `?task=`.
- `ConsoleShell` hands the bundled recorded run to History, only in Recorded mode.
- `History` accepts that initial run.

### 3. Event-state reliability

Fixed in `events.ts`. The fold is now per action:
- **Verifying one of two actions** used to show "verified". It now shows "checking" until every applied action is verified, and "failed" if any failed.
- **Approving one of two pending changes** used to clear "waiting". It no longer does.
- **Delivery order:** events are deduplicated by id and re-ordered by audit id.
- **Scenario reset:** clears per-action state (ids are reused) but keeps learned skills.
- **Non-boolean `passed`:** treated as a failure.
- **`task_end` success:** only shown as success when the fold agrees.
- **Live:** a pending approval reported by the API forces "waiting".
- **Lost connection:** Live shows "(connection lost)".

Tests in `e2e/world-events.spec.ts`, 15 total: duplicate, missing, delayed, reordered, restarted, failed and malformed workflows, plus source separation.

### 4. Visual QA fixes

- The gate sign first collided with the server room, then sat on the library shelf; it's now in the empty corridor.
- Story zoom (1.55 → 1.38) no longer cuts the edge signs.
- On phones, the key moved below the scene, which now uses an aspect-fit frame.
- Link colour now meets contrast.
- The key's sprite is still and its background opaque. The animated, translucent key had raised desktop main-thread use from 27 % to 34–37 %; it's now 20–23 %.

### Test evidence (this branch, Windows dev box)

| suite | result |
|---|---|
| `npx playwright test` (console 29 + world 8 + world-events 15) | **52 passed** |
| `npx playwright test -c playwright.live.config.ts` (real API + real rehearsal) | **7 passed**, including the new `?task=` test; the restore test's pre-existing table-load race was fixed |
| perf (`scripts/world-perf.mjs`, `perf/world-perf7*-final.json`) | desktop 60 fps, 20–23 % main thread; phone with 4× throttle 48–54 fps; reduced motion 4–5 %; 0 off-machine requests |
| backend / trusted core | unchanged since rc1 (`git diff rc1 -- app scripts tests` is empty) |
