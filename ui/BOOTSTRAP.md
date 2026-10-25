# Bootstrap cinematic (branch `exp/bootstrap`, based on `exp/world`; EXPERIMENT, not merged)

Route: `#/world/bootstrap`. The scenes run Appliance → Connect → Discover → Permissions → the Daylight World, which is unchanged, → console.

`#/world` is unchanged and still loads directly, and the console is untouched. The trusted backend was not touched.

## What is illustrative and what is real

| on screen | status |
|---|---|
| the whole Bootstrap sequence | **Illustration.** It is tagged "Illustration" on the stage, and a bar says "Bootstrap is not built yet. Nothing on this page connects to anything." |
| connection statuses | illustrative graphics, but the statuses are **the true state of SkillForge today**: local records *supported* (SkillForge can read them; this page checks nothing), Slack *awaiting authorization* (NemoClaw `channels add` needs tokens and an admin), local model *configured, unverified* (no health check on this page; real health is in the console), Git and ERP *unavailable* (not built). Shape carries meaning, not colour alone: ● ○ ◐ ✕ |
| discovery output, the manifest | **example data.** Field names follow the real read-only manifest of `experiments/router/bootstrap.py` (`environment`, `tool_inventory`, `missing_skill_opportunities`, `required_permissions`), so a real manifest can later feed the same view. Discovery claims nothing for systems it can't reach ("not started", "not reachable", "nothing read yet") |
| the office at the end | the world's own `<Scene>` with an empty state (nothing happened yet), not a copy. Below it, the world's story (illustration), replay (recorded/live) and legend run unchanged |
| green / "verified" | never used in the prelude. Green stays reserved for an independent verifier passing (tested) |

## Design notes
- **Tokens and type:** Daylight's own (sky `#DCEBF5`, ink `#14203A`, 2 px frames with hard offset shadows, Schibsted Grotesk; JetBrains Mono only for the manifest's machine text). No new colours or libraries: Motion and SVG only.
- **Layout:** the stage sits on the left, where the world's story keeps it, so the hand-over is continuous. Below 1024 px the stage stacks on top (sticky, landscape) so its labels stay legible.
- **The one bold moment is the transition.** Each Bootstrap element lands in the room that does its job:
  - the appliance → the Local AI room
  - records and chat → Operations intake
  - "a person approves" rows → the Human review desk and the Skill library
  - the verifier row → the Independent check
  - Git and ERP fade out, because unavailable systems don't enter the office
- **Mechanics:**
  - Scroll is native, with a sticky stage and `useScroll`; it is never hijacked.
  - Groups move by writing an SVG `transform` attribute from motion values, so there is no React render per frame. A CSS transform origin isn't the group's local origin in SVG, which put the appliance off-centre in the first build.
  - The scene nav (5 buttons, `aria-current="step"`) and "Skip to the office" are keyboard reachable. "Open the console" is in the truth bar and the final scene.
  - **Reduced motion and phones:** each scene's settled frame as a card, with no scrubbing and no frame timers.

## Visual QA (`node scripts/bootstrap-shots.mjs`, with `npm run preview`)

Screenshots are in `screenshots/bootstrap/`:
- **1440, 1024, 768:** every scene, three transition frames (`t1`–`t3`), the office, and `6-world-story` (the hand-over into the world's first beat).
- **390 and 1440-reduced:** the settled cards.

The script fails on any non-local request, page error or horizontal overflow; the final run reported none.

Fixed during review:
- the appliance was scaled about the wrong origin
- dashed cables never faded out
- landing chips piled up at intake
- a manifest row ran into its stamp
- the 768 portrait stage was illegible, so it now stacks
- the ERP card sat under the scene nav at tablet height
- "Local model: 1 model, tool calling" claimed discovery of a model that isn't running; it now says "not started"

## Tests (`npx playwright test --workers=2`): 68 passed
- **New `e2e/bootstrap.spec.ts` (9):**
  - illustration labels and the true statuses (one "supported"; never "connected", "available", "healthy" or "running"), no live/recorded tag, no "verified"
  - scroll drives the scene; the keyboard reaches every scene, the office and the console
  - the office is the world's and its replay and department dialogs still work after Bootstrap
  - reduced motion is settled and nothing blinks
  - no external request
  - axe (no serious/critical) and no horizontal scroll at 1440, 1024, 768 and 390
- **Existing:** the console and world suites, unchanged and passing. Earlier, one console test was flaky under full parallel load (it passes alone, and on rc1), so this suite runs with 2 workers.

## Performance (dev box, installed Edge, CDP; `node scripts/bootstrap-perf.mjs`)

| measure | `#/world` | `#/world/bootstrap` |
|---|---|---|
| JS loaded (compressed, all chunks) | 133 KB | 142 KB (+9 KB; the Bootstrap chunk is 5.4 KB gzip and loads only on its route) |
| full-page 6 s scroll | 60.0 / 56.1 fps | 58.0 / 52.3 fps |
| long tasks, full-page scroll | 0 / 5 | 3 / 5 |
| Bootstrap section only, 6 s scroll ×3 | — | 60.2 / 60.1 / 60.1 fps; p95 frame 17.6–18.4 ms; worst 20–31 ms; **0 long tasks** |
| idle main-thread busy, page top | 1.9 / 3.3 % | 1.4 / 2.3 % |

The run-to-run spread is large on this machine: the second `#/world` run alone had 5 long tasks. The full-page long tasks come from the world section below, which has them without Bootstrap too. Bootstrap itself measured no long tasks.

## Next step: functional Bootstrap Lite (separate milestone, not simulated here)
1. **Backend first.** Add a host-side, operator-run `python -m experiments.router.bootstrap <dataset>`, already read-only and tested on `exp/router`. It would write `manifest.json` next to the DB and serve it read-only via the operator API (`/ui/bootstrap`, GET, session-only).
2. **Same view, real data.** Feed that manifest into this view, with the source tag switched to "Live". Discovery shows only what the manifest contains. Statuses come from real checks (`ops.status`, `nemoclaw channels status`), and unknown stays unknown.
3. **Authorization stays a host command.** Connecting a system is a human-run CLI step with its own approval, never a button on this page.
