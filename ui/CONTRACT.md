# UI ↔ SkillForge integration contract

**Status: IMPLEMENTED** as `app/ui_api.py` (`python -m app ui`); endpoints, security review and tests in `docs/LIVE_CONSOLE.md`. Differences from the proposal: same origin as the console (no CORS), session cookie from a one-time URL, plus `/ui/events`, `/ui/actions/{id}`, `/ui/skills/{name}/{v}`. Original proposal below.

**Original status: PROPOSED.** The trusted service (`app/server.py`) deliberately exposes only the agent's tools to the sandbox, behind the agent token. The UI must not use that token, and it must not get any write path. This document defines the smallest read-only surface the console needs, for review before anyone adds it to the host.

## Data modes (always labelled in the UI by `SourceBadge`)

| mode | source | what is shown | status |
|---|---|---|---|
| Synthetic preview | `src/data/synthetic.ts` (scripted) | every state, plus failure rehearsal | **working** |
| Recorded run | a real `result.json` from `python3 -m app bench --out <dir>` loaded in the browser | measured A/B/C rows, model calls, medians; null stays "not measured"; a mock run is labelled mock | **working** (parses the real backend format) |
| Live | proposed operator API below | system status, tasks, steps, skills, pending approvals | **not connected**: the UI says so and shows nothing rather than guessing |

The UI never falls back from live to synthetic. If live fails, it shows the failure.

## Proposed read-only operator API

**Constraints:**
- A new host process, e.g. `python3 -m app ui-api --bind 127.0.0.1 --port 8766`, separate from `serve`.
- GET only.
- Bound to loopback only (the browser runs on the same machine; the sandbox can't reach host loopback).
- Its own operator token, distinct from the agent token.
- **No approval, promotion, reset or execute endpoints.** Every response is a projection of functions that already exist.

| method + path | backed by (existing code) | response |
|---|---|---|
| `GET /ui/status` | `app.ops.status(conn)` | `SystemStatus` (`src/data/types.ts`) |
| `GET /ui/tasks?limit=50` | `SELECT id,label,mode,status,model,started_at,ended_at,latency_s,model_calls,tool_calls FROM tasks` | list |
| `GET /ui/tasks/{id}` | task row + `tool_calls WHERE task_id` (tool, ok, ms; **no args/results**) + actions with `ops.workflow_state` + verification checks | detail |
| `GET /ui/skills` | `skillforge.list_skills(conn)` | list. **Hidden-suite case names and details are excluded**: only `hidden_ok`. |
| `GET /ui/approvals` | `tools.pending_approvals(conn)` | the UI shows each with the host command to approve it |
| `GET /ui/bench/latest` | newest `results/**/result.json` | the same parser as the recorded mode |

## Approvals and promotion

The browser **cannot** approve anything. The console shows the exact host command (`python3 -m app approve <id> --by <name>`, `python3 -m app skill approve <name> <v> --by <name>`) and then polls `/ui/approvals` to show the actual result.

The buttons in the synthetic preview drive the script only, and they say so.

## What the UI must never show

- Agent chain-of-thought. Only observable actions are shown: tool names, short results, evidence summaries.
- Hidden validation cases (oracle leakage), the agent token, `LLM_API_KEY`, or the raw tool arguments of real records unless an operator opens them deliberately.
- Synthetic or illustrative numbers without the "Synthetic preview" or "Example values" label.
