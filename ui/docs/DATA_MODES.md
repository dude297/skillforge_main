# Data modes: PREVIEW and LIVE

> Status: **proposed**. This describes what the frontend does today. The authoritative operator-API contract comes from the integration team; `CONTRACT.md` is the original proposal and `docs/LIVE_CONSOLE.md` (repo root) describes `app/ui_api.py`. Where this file and the backend disagree, the backend wins and `src/data/live.ts` (the `V` validators) is what has to change.

Code entry point: `src/data/index.ts` (a barrel; `dataMode()` returns `"preview" | "live"`). No screen imports it yet; consumers still import the individual modules.

## 1. The two modes at a glance

| | PREVIEW | LIVE |
|---|---|---|
| Build | `VITE_PREVIEW=1 npm run build` (`npm run build:preview`) | `npm run build` |
| Where it runs | Vercel (static files only), or `vite preview` | served by the host process `python3 -m app ui`, same origin |
| Flag | `PREVIEW` in `src/lib/preview.ts`, replaced at build time | same flag, `false` |
| Network | same-origin GET of static files in `dist/` only | plus GET to the operator API (`/ui/*`) |
| Operator API | never called: `live.*` returns `{ok:false, reason:"unreachable"}` before any `fetch` | polled (1.5 s tasks/approvals/skills/events, 5 s status) |
| Console sources offered | Preview (synthetic), Recorded | Preview, Recorded, Live |
| Chrome | "Read-only preview" strip on every route | none |
| Approve / promote / reject / roll back | scripted rehearsal buttons drive local state only; nothing is sent | never in the browser: the UI shows the host command (`commands.ts`) and polls for the result |

In both modes the UI never falls back from a failed live call to fixtures, every number carries its source (`SourceBadge`, "Illustration", "Recorded scripted simulation"), and `null` renders as "not measured", never 0.

## 2. What PREVIEW reads

Everything is in the bundle or in `dist/`; nothing is fetched from another origin (fonts and icons are bundled).

| What | File | Used by |
|---|---|---|
| Scripted run, failure rehearsals (model offline, connection drop, verification fails) | `src/data/synthetic.ts` | console "Preview" source (`useSyntheticRun`, `SYNTHETIC_STATUS`, `REPLAY_STEPS`) |
| Sample skills and history | `src/data/registry.ts` (`SKILLS`, `HISTORY`) | console Skills, History |
| Real model registry | repo `data/models.json`, imported by `registry.ts` and bundled | console System |
| Recorded run for the Office | `src/world/recorded-run.json` | `#/world`, console Recorded source |
| Illustrated onboarding | `src/world/bootstrap-data.ts` | `#/world/onboard`, `#/world/bootstrap` |
| OnCall run | `public/demo/oncall-run.recorded.json` -> `dist/demo/…`, fetched as `./demo/oncall-run.recorded.json` | guided demo `#/demo` |
| Bench result / audit export | not bundled; the visitor loads a file in the browser (`parseBenchResult`, `parseAudit`) | Benchmarks, History |

`useOnCall`/`loadOnCall` try the live endpoint first only when `PREVIEW` is false, then the recorded file; if both fail the demo shows "UNAVAILABLE" and says nothing is filled in.

## 3. What LIVE reads

Base URL: `VITE_OPERATOR_API` at build time, default `/ui` (`live.base`). Requests are `GET` with `credentials: "same-origin"`, `cache: "no-store"`, 6 s timeout (status 40 s, bootstrap discovery 30 s). The session is an HttpOnly cookie set when the operator opens the one-time URL printed by `python3 -m app ui`; the UI holds no token. `VITE_OPERATOR_API` is baked into the bundle, so never point a public build at a private address (`scripts/scan-public.mjs` fails on it).

Adapter: `src/data/live.ts` (`live.health/status/tasks/task/events/approvals/skills/skill/benchLatest/workspaces/discover`). Polling: `src/data/useLive.ts`. Row mapping: `src/data/liveMap.ts`.

### Endpoints and the shape check each must pass

A response that fails its check becomes `bad_response` and nothing is rendered from it. Only the listed top-level keys are checked at the door; the other fields below are *read by components* and are typed, not validated.

| GET | Must satisfy (`V.*`) |
|---|---|
| `/health` | `{ok:true, read_only:true}` |
| `/status` | `inference`, `sandbox`, `host_service` each `{ok, detail}`; `db.quick_check: string`; `next_actions: array` |
| `/tasks?limit=50` | `{ok:true, tasks:[…]}` |
| `/tasks/{id}` | `{ok:true, task:{…}, events:[…], actions:[…]}` |
| `/events?after=<id>&limit=500` | `{ok:true, events:[…], last_id:number}` |
| `/approvals` | `{ok:true, pending:[…]}` |
| `/skills` | `{ok:true, skills:[…]}` |
| `/skills/{name}/{version}` | `{ok:true, skill:{…}, files:{…}}` |
| `/bench/latest` | `{ok:true, file:string, result:{…}}` |
| `/demo/oncall` | `schema == "skillforge.oncall_run/1"` and `mode: string` (`isOnCallRun`) |
| `/bootstrap/workspaces`, `/bootstrap/discover/{id}` | experiment (`exp/bootstrap-lite`): `{workspaces:[…]}`; `{capabilities, workflows, permissions, manifest}` |

### Fields the UI reads

**Status** (`LiveStatus` = `SystemStatus` + …): `inference{ok,detail,model,learning_allowed?}`, `sandbox{ok,detail}`, `host_service{ok,detail}`, `db.quick_check`, `next_actions[]`, `checked_at`, `open_tasks[{id,label,mode,age_s}]`, `workflows_by_state{state:id[]}`, `approved_skills[]`. `ok: null` means unknown, not healthy.

**Task** (`LiveTask`): `id, label, scenario, mode ("real"|"mock"|"deterministic"), status ("open"|"closed"|"aborted"), model, started_at, ended_at, latency_s, model_calls, tool_calls, duplicate_tool_calls, actions_executed, verifications_passed, verifications_failed, invariant_violations, success, skills_used[], skill_proposed[], tool_breakdown{tool:n}`. Any numeric may be `null` (not measured).

**Task detail** (`LiveTaskDetail`): `task`, `events[]`, `events_complete`, `events_truncated`, `tool_calls[{id,tool,ok,ms,ts}]` (no args or results), `actions[]`, `skills_proposed[{name,version,status}]`.

**Event** (`LiveEvent`): `id` (monotonic audit id; the dedupe key), `ts`, `actor`, `event` (`approval_rejected` etc.; unknown names render generically), `payload{}` (only small summaries are shown). `/events` also returns `anchor{id,ts,event}` used to detect a replaced database.

**Action / pending approval** (`LiveAction`): `id, fingerprint, task_id, record_id, type, field, value, reason, status, state` (`PENDING|WAITING_APPROVAL|READY|VERIFYING|COMPLETED|NEEDS_REVIEW|CANCELLED|FAILED`), `origin, created_at, current_value`, `approval{status,decided_by,requested_at,decided_at}|null`, `execution{at,changed{field:[from,to]}}|null`, `verifications[{passed,at,checks[{check,passed,actual?,expected?}]}]`, `evidence[{source,trusted,summary}]`. `fingerprint` (8 hex) is put into the copied host command as `--expect`.

**Skill** (`LiveSkill`): `name, version, parent_version, status, active, description, decided_by, source_task, created_at, sha256, touches[]`, `validation{lint_errors, own_tests_ok, own_tests, replay_ok}`, `hidden_ok` (verdict only; hidden-suite case names must never be sent), `optimization{recommended,retained,warm_speedup}`, `runs{total,ok,refused,error,verified_pass,verified_fail}`. Skill detail adds `files{name:text}` and `files_note`.

**Bench** (`LiveBench`): `file, mtime, result` where `result` goes through the same parser as the Recorded source (`summary[]` rows `case, mode A|B|C, n, correct, decision, median_s, model_calls, tool_calls`; `real_model`, `agent`, `trials`, `breakeven_C`).

**OnCall run** (`OnCallRun`, schema `skillforge.oncall_run/1`): `mode` (`LIVE_REAL_MODEL` is the only value treated as a real model run), `generated_at, host`, `model{id,endpoint,available,note}`, `incident{id,title,service,summary,evidence[{kind,name,excerpt,source_path}]}`, `synthesis{provenance ("model"|"recorded_reference"),model_calls,latency_ms,prompt_tokens,completion_tokens,code,skill_name,skill_version,skill_hash}`, `verification{hidden[],regression[],passed,note}`, `approval{state,by,at,command,kind}` (only `kind:"host_cli"` counts as a person), `reuse{incident_id,path,model_calls,latency_ms,diagnosis,state,reason}`, `refusal{…}`, `telemetry{gpu,note}`, `audit[{t,event,detail}]`. Every field may be `null`.

### Never sent, never shown
Agent chain-of-thought, hidden validation case names, tool-call arguments or results, the agent token, `LLM_API_KEY`. The browser exposes no write endpoint and the adapter has no non-GET call.

## 4. How failures render

Live failures are never papered over with fixtures.

| Failure | Result (`LiveResult.reason`) | What the person sees |
|---|---|---|
| Preview build, any live call | `unreachable` (no request made) | Live is not offered; `?source=live` is ignored |
| No answer / network error / timeout | `unreachable` | Console: "Not connected to a live system" with the base URL and the error text; retries with backoff (1.5 s doubling to 10 s) |
| HTTP 401 | `unauthorized` | "Sign in to this system's console": open the one-time URL printed by `python3 -m app ui` |
| HTTP 4xx | `bad_response` (detail from `error.message`) | same "not connected" view with the detail |
| HTTP 5xx | `server_error` | same, with the detail |
| 2xx with an unexpected shape | `bad_response` ("unexpected response shape") | same; nothing is rendered from the payload |
| Connection lost after being connected | `conn: "lost"` | last received data stays, marked stale; health is never shown from a lost connection |
| `/status` alone fails or is slow | `statusError` only | status panels say why; the rest of the console stays up; an old status is dropped, not kept |
| Audit ids go backwards or the anchor changes | resync | event stream is re-read from 0 |
| OnCall run missing | `{state:"missing", detail}` | guided demo shows "UNAVAILABLE" and "Nothing is filled in" |
| Recorded file not a bench result / audit export | parser throws | alert with the reason ("not a bench result.json (no 'summary' array)") |

## 5. Switching the backend

1. Same origin (normal): serve `dist/` from `python3 -m app ui`; leave `VITE_OPERATOR_API` unset (`/ui`).
2. Different origin: build with `VITE_OPERATOR_API=https://host/ui`. That requires CORS and credentials handling on the backend (not implemented; the proposal in `CONTRACT.md` assumes same origin), and it changes the CSP `connect-src` in `vercel.json` if ever hosted. Do not do this for the public preview.

## 6. QA tooling for these modes

| Command | Proves |
|---|---|
| `npm run build:preview` | the preview bundle |
| `npm run scan:public` | no secrets, private URLs, absolute paths, source maps, `.env`, baked `VITE_OPERATOR_API` in `dist/` |
| `npm run check:csp` | every route and the interactive flows load under the CSP in `vercel.json` with zero violations |
| `npm run test:preview` | all routes load clean; zero off-origin and zero `/ui/` requests; no non-GET; strip on every route; no Live source; no overflow at 390 and 1440; deep links; `vercel.json` rewrites and headers |
| `npm run a11y` | axe sweep (WCAG 2.0 to 2.2 AA tags) of every route at 1440 and 390 plus two interactive states; report in `qa-reports/a11y/` |
| `npm run qa:preview` | build, scan, CSP, e2e in one go |
