# Bootstrap Lite (branch `exp/bootstrap-lite`, from `exp/bootstrap-honesty`; EXPERIMENT, not merged)

Route: `#/world/onboard`. These are five steps over the **real** read-only manifest, followed by the unchanged Daylight World. `#/world`, `#/world/bootstrap` (the illustration) and the console are untouched. No core file (`app/`, `adapters/`) was changed.

```bash
python -m experiments.bootstrap_lite            # = `python -m app ui` + 2 GET routes; open the printed one-time link
# then http://127.0.0.1:8766/#/world/onboard
```

## How it works (no new bootstrap logic)
| piece | source |
|---|---|
| discovery | `experiments/router/bootstrap.py` `manifest()`, an unchanged copy from `exp/router`, with `experiments/catalog/catalog.py` and the `freight_week2.json` fixture |
| health | the operator API's own cached `ops.status` (`ui_api.status`) |
| transport | `app/ui_api.py` as is: loopback only, Host check, operator session, read-only DB, size cap. `experiments/bootstrap_lite/lite.py` appends `GET /ui/bootstrap/workspaces` and `GET /ui/bootstrap/discover/<id>` to its `ROUTES` at startup |
| state assignment | `lite.states()`: one pure function. The UI renders the state it is given and never upgrades it |
| workspace selection | by id from an allowlist (`freight-week2` plus `data/learning/*.json`). A path never comes from the browser. Unsupported files are listed with the reason, not hidden |

## States (backend rule → label shown)
| state | assigned only when | shown as |
|---|---|---|
| active | the health check answered ok, or an approved+active skill is an **exact** match for this workspace, or the checker rule exists in this build's verifier code | ● Active |
| approved | a skill is person-approved but is **not** a match here (near miss) | ◇ Approved, not in use here |
| configured | the records are loaded in the app DB, or a health check is set up but failing | ◐ Set up, not working |
| discovered | it was read from the workspace file and nothing is set up; also proposed workflows | ○ Found only |
| unavailable | there is no health answer, it isn't set up, or the checker rule isn't in this build | ✕ Unavailable |
| illustrative | Slack, Git or ERP, from the cinematic. Labelled and never checked | ⬚ Example only |

Shape carries the meaning and the text label is always present. "Active now: …" is one sentence at the top of every result step. Permissions are always shown as **Granted: No**. Each one is a host command a person runs per change, and the page has no button for it.

**Real finding on the supply-chain workspace:** rc1's verifier implements only `sum_lines`. The freight workspace declares `carrier_invoice_net`, so its independent check shows **Unavailable**. On this build, freight changes could not be verified. The pinned freight verifier exists only on `exp/enterprise` and a review branch, neither merged. Bootstrap Lite reports this instead of hiding it.

## Tests
- `python -m pytest -q -p no:cacheprovider experiments/bootstrap_lite/test_lite.py`: 9 passed. They cover:
  - freight: nothing active, the checker unavailable, nothing granted, and the DB bytes unchanged
  - an exact-match skill is active, a near miss only approved, a disabled skill gone
  - the health ok/False/None → active/configured/unavailable matrix
  - illustrative items stay illustrative
  - hostile ids are refused
  - the routes need a session, POST gets 405, and nothing is written
- `npx playwright test -c playwright.live.config.ts e2e-live/bootstrap-lite.spec.ts`: 5 passed (about 20 s). It runs against the real backend and a throwaway DB, with no UI fixtures:
  - the full 5-step freight flow, with axe on each step, the DB hash unchanged, and the hand-over into the existing world
  - Active vs Approved with a real (mock-learned) skill
  - keyboard only
  - 390 px with reduced motion and no horizontal scroll
  - no session → an alert and no data
- Regression:
  - the existing `npx playwright test --workers=2` suite: 68 passed
  - `tests/test_contracts.py tests/test_ui_api.py experiments/bootstrap_lite`: 53 passed, 1 skipped
- Screenshots: `screenshots/bootstrap-lite/{1440,390}-{1..5}.png` (`e2e-live/bootstrap-lite-shots.spec.ts`).

## Usability check: NOT RUN (needs a person)
No nontechnical reviewer has used this yet. The automated proxy is the "Active now" sentence plus the e2e assertions above. That proxy is not the requirement.

Protocol (10 min, freight workspace, model not running):
1. Say only: "Set this up for the freight workspace, then tell me what is working right now."
2. Don't help. Record the time to step 5 and every hesitation.
3. Ask:
   - Q1 "Which capabilities are active?"
   - Q2 "Can it change a freight accrual today without anyone approving?"
   - Q3 "Is Slack connected?"
   - Q4 "What would have to happen before freight fixes can be checked?"

**Answer key** (dev box, no model):
- Q1: nothing.
- Q2: no.
- Q3: no, it's an example.
- Q4: an independent check for `carrier_invoice_net` would need to exist. On the GB10 with the model up, Q1's answer becomes "the local model" (and the sandbox, if `nemoclaw` answers).

Pass bar: Q1 and Q3 correct with no help.

## Demo vs later
| demo (if adopted) | later |
|---|---|
| Run `python -m experiments.bootstrap_lite` in place of `app ui`, on the same port, with the same auth. Show freight discovery and its honest "nothing active / check unavailable" | real connectors (Slack status via `nemoclaw channels status`), workspace types beyond ops fixtures, merging the routes into core `ui_api` |
| The world and the console unchanged | the pinned freight verifier (review branch) would flip the freight check to Active, with no UI change |

## Limitations
- There is one supported workspace type: a SkillForge ops fixture JSON. "Workspace" means a file in the allowlist, not a folder picker.
- The checker-rule detection reads `app/tools.py` source with a regex (marked `ponytail:`). A core verifier registry should replace it.
- Health uses `ops.status`, cached for 10 s. Inference with no `LLM_BASE_URL` counts as unavailable, never active.
- The illustrative items are fixed text.
- The usability study was not run.
- `bootstrap.py` and `catalog.py` are copies from `exp/router`. If that branch changes, they must be re-synced.
