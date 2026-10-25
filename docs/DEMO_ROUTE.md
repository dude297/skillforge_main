# Demo route: click by click

Companion to `docs/LIVE_DEMO_RUNBOOK.md` (host commands, GO/NO-GO) and `docs/JUDGE_PITCH.md` (words). This file is the browser side only. Timings marked *est.* were rehearsed on a dev box with the recorded file, not on a GB10.

**Before anything:** open `#/demo` at 1440 px wide (also fine at 1024/768/390). The coloured banner under the top bar is the truth label on every scene. Read it aloud first.

| Banner | Means | Say |
|---|---|---|
| LIVE REAL MODEL | `mode == LIVE_REAL_MODEL` and code provenance is `model` | "The local model wrote this code, a few minutes ago." |
| RECORDED SCRIPTED SIMULATION | recorded file, hand-written reference code | "This is a recorded simulation. The code is not model output." |
| DETERMINISTIC SKILL | scene 5 only, when reuse actually ran | "Fixed code ran: no model, no agent." |
| UNAVAILABLE | no valid run file | Say so; go to Recovery below. Nothing is filled in. |

Keys: Right/Left = next/previous scene, Space = Play/Pause, N = notes (`#/demo` presenter). Autoplay stops at scene 4 while the skill is not approved.

## A. Live variant (~6 min in the browser, *est.*)
Host side first (runbook A1 to A2). Browser opens the printed login link, then `#/demo`.

| t | Click / key | Scene | Point to | Say |
|---|---|---|---|---|
| 0:00 | Open `#/demo` | 1 Company onboarding | Banner, then the five steps | "Read-only discovery of the company's tools and permissions. Nothing here writes." |
| 0:30 | Right | 2 Enter the living company | Ember and the rooms | "Each room is a real stage. Ember is only an indicator; it follows the run file." |
| 0:50 | Right | 3 An incident arrives | INC-1 evidence list with file paths | "Every evidence item names the file it came from." |
| 1:20 | Right | 4 The fix becomes a tested skill | "Who wrote the code", hidden-test list, approval box | "Lint, own tests, replay of INC-1, nine hidden cases the model never saw." Banner must say LIVE REAL MODEL; if verification shows failed, that is the result (runbook GO/NO-GO 2). |
| 2:20 | (host) A types the approve command with their own name, then reload `#/demo`, Right x3 | 4 | Approval: "Approved by <name>" | "The browser cannot approve. A person did, on the host." |
| 3:00 | Right | 5 The next one takes the short path | INC-2 table (model requests, latency), INC-3 refusal | "INC-2: same failure class, fixed code, 0 model requests. INC-3 looks alike but is a full disk; the fingerprint differs, so it is refused and handed to a person." Latency is one measured run, not a benchmark. |
| 4:00 | Right | 6 Technical proof | Click Approval, Reuse, Audit trail in the inspector | "Every field is from the run file. Fields we did not measure say 'not measured'." |
| 5:00 | Click "Open in the console" | Console, Investigations, OnCall incident | Same proof, same banner | Close on the INC-3 refusal. |

## B. Fallback variant: recorded simulation (~3 min)
Use when preflight fails, the model is down, or `oncall` exits 2. Serve the UI (`bash deploy/gb10/sf-gb10.sh demo`, or `npm run preview` in `ui/` and open `http://127.0.0.1:4173/#/demo`).

Open with: **"This is a recorded simulation. The code is a hand-written reference and the approval was typed by an agent, not a person. The banner says so."**

| t | Click / key | Scene | Say |
|---|---|---|---|
| 0:00 | Open `#/demo` (or press Play: about 1.5 s per beat, 2.6 s dwell, about 90 s to scene 4) | 1-2 | Onboarding and office, same as live. |
| 0:40 | Right x2 | 3 | Evidence with source paths. |
| 1:10 | Right | 4 | "RECORDED SCRIPTED SIMULATION. Approval is labelled 'not a person's decision'. The verification flow is the real one." Autoplay pauses here; press Right to continue. |
| 1:50 | Right | 5 | "This part is deterministic and ran on this machine: 0 model calls on INC-2; INC-3 refused." |
| 2:30 | Right | 6 | "Provenance for every field." Done. |

## Recovery (browser)
| Symptom | Do |
|---|---|
| Scene 1 says "Discovery failed" | The operator API is not running or the login link expired (10 min). Say so, continue to scene 2; the OnCall scenes do not depend on it. Renew: `python3 scripts/unified.py link --port 8766`. |
| Banner UNAVAILABLE and scenes 3-6 say "No OnCall run to show" | No valid run file. Serve from the host (`python -m app ui`) or rebuild with `ui/public/demo/oncall-run.recorded.json`. Do not edit the file. |
| Console shows "not connected" or stale data | Intended: the UI never falls back from live to synthetic. Use `#/demo` (recorded, labelled) instead. |
| Page looks stale after a new `oncall` run | Reload; the run is read once per page load. |
