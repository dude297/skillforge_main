# Live console: read-only operator API + real-backend integration

`python -m app ui` serves the built console (`ui/dist`) and a read-only JSON API from **one loopback origin**
(`http://127.0.0.1:8766`). The console's Live mode shows only what this API returns. It never shows UI fixtures.
Preview mode (scripted) and Recorded mode (files you load) stay separate and labelled.

## Endpoints (all GET; everything except `/ui/health` needs the operator session)

| path | backed by | notes |
|---|---|---|
| `/ui/health` | none | public; says only "this is the read-only API" (lets the page start in Live mode) |
| `/ui/status` | `ops.status` | cached 10 s (it may shell out to `nemoclaw` and probe inference). Unknown stays `ok: null` |
| `/ui/tasks?limit=` | `tasks` | newest first, limit clamped to 1..200; `model_calls` null = not measured |
| `/ui/tasks/{id}` | task row + its audit range (`task_begin`..`task_end`) + `tool_calls` (tool, ok, ms) + actions + skills it proposed | |
| `/ui/events?after=&limit=` | `audit` | incremental by audit id (dedupe key); `last_id` going backwards = DB reset or restore |
| `/ui/approvals` | pending `approvals` | each with the derived workflow state, evidence and verification checks |
| `/ui/actions/{id}` | one action | same projection |
| `/ui/skills`, `/ui/skills/{name}/{v}` | `skills`, `skill_runs`, candidate files | only `hidden_ok`: hidden cases never leave the host. Files: SKILL.md, helper, the agent's own tests |
| `/ui/bench/latest` | newest `results/**/result.json` | summary keys only (no rows, no DB path) |
| `/auth?code=` | none | one-time login link (10 min, single use; mint with `python -m app ui --link`). Sets a signed, expiring (12 h) session cookie, `HttpOnly; SameSite=Strict`, never the token |

## Security review (what enforces each boundary, and the test that proves it)

| boundary | enforcement | test (`tests/test_ui_api.py`) |
|---|---|---|
| no write path from the browser | 405 on every non-GET (body drained, `Allow: GET`); the DB is opened `mode=ro` plus `query_only`; no approve/promote/execute routes exist | `test_write_methods_are_refused_everywhere`, `test_the_api_never_writes` (DB bytes unchanged; a write through the connection raises) |
| only this machine | binds 127.0.0.1 only; exactly one Host header naming this loopback origin and an origin-form request target (DNS rebinding); no CORS headers | `test_refuses_non_loopback_bind`, `test_dns_rebinding_host_is_refused`, `test_duplicate_host_and_absolute_targets_are_refused` |
| only the operator | its own token (`data/.operator_token`, 0600, gitignored; env override must be ≥32 chars), used as `Bearer` by CLI/tests only; browsers get a one-time HMAC login link and a signed expiring session id (survives API restarts; rotate the token file to revoke all); the agent token is not accepted; constant-time byte compares (non-ASCII → 401, not a crash) | `test_every_endpoint_answers_and_needs_the_operator_token`, `test_agent_token_is_not_an_operator_token`, `test_login_link_works_once_and_sets_a_signed_session`, `test_expired_forged_and_legacy_login_links_are_refused`, `test_sessions_are_signed_expiring_and_survive_a_restart`, `test_non_ascii_credentials_are_a_401_not_a_crash`, `test_short_operator_tokens_are_refused` |
| no oracle or secret leakage | per-event payload allowlist (non-dict params dropped); execute shows only the changed fields; no approval notes, input snapshots, args hashes or hidden cases; known secrets (operator/agent tokens, `LLM_API_KEY`, the NemoClaw vLLM key file) are scrubbed BEFORE truncation and again on the whole response; control and bidi characters stripped from agent text | `test_nothing_secret_or_oracle_leaves_the_api`, `test_secret_values_are_redacted_even_if_a_row_contains_them`, `test_secrets_cut_by_truncation_and_spoofing_characters_never_reach_the_console`, `test_non_dict_params_are_not_echoed` |
| bounded input and output | ids `\d{1,12}`, skill names `NAME_RE`, integer-only queries (400 otherwise), limits clamped, 2 MB response cap (413), static files confined to `ui/dist` (no traversal, no listing) | `test_invalid_ids_and_malformed_queries`, `test_oversized_responses_are_refused`, `test_static_files_cannot_escape_the_bundle` |
| browser hardening | CSP `default-src 'self'` (no inline script, `frame-ancestors 'none'`), `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, `no-store` on the API | asserted in the static-file test |

Not changed: `serve` (the agent's tool service), the agent tool allowlist, the policy, approvals, the verifier and the
hidden suite. The sandbox can't reach host loopback, so the agent cannot reach this API.

**Residual risks, accepted for a single-user demo box:**
- Any process running as the same OS user can read the token file. That's the same trust level as `data/app.db` itself.
- A WAL-mode read-only reader may create `-wal`/`-shm` files if they're missing. Writes are still refused.
- `ThreadingHTTPServer` has no thread cap (slowloris), which is acceptable on loopback.
- `ops.status` (cached 10 s, never blocks readers) shells out to `nemoclaw`, probes the agent service without a token, and runs `PRAGMA quick_check`. None of these write the DB.

**Approve commands are bound to what was reviewed.** Every command the console shows carries `--expect <fingerprint>`, a hash of the record and the change. `python -m app approve` refuses on any mismatch, which covers two cases:
- action ids restart after a scenario reset, so the same id can name a different change
- the operator's shell may point at another `APP_DB`

Tests: `test_approve_expect_binds_the_command_to_the_reviewed_change`, `test_api_fingerprint_matches_the_cli`. The live e2e runs the exact copied command.

## Rehearsal: a real backend workflow with a scripted mock agent

```bash
npm --prefix ui run build                                    # once (or restore ui/dist from the offline stage)
python3 scripts/rehearse.py --ui --approve manual --pace 1   # prints a one-time login link; open it
#   The console shows each tool call as the host records it. At "Waiting for you" run the printed command in another
#   terminal, e.g. APP_DB=data/rehearsal/app.db python3 -m app approve 1 2 --by <name>, then the skill promotion.
python3 scripts/rehearse.py --ui --approve auto --pace 0.9 --bench   # hands-free version + a MOCK benchmark
python3 scripts/rehearse.py --keep --fail-verify --restart-service   # faults: verifier finds drift; service restarts
```

What's real in the rehearsal:
- `python -m app serve` with a per-run agent token, and every tool call over HTTP POST `/call`
- the policy, the human approvals (host CLI), the verifier, the skill sandbox, the hidden validation and the audit trail
- the console, which reads all of it through the API

What isn't: the agent's decisions, which are a fixed script, and the skill code, which is the mock-authored fixture (its own header says so). Every screen labels these "Mock agent (scripted, no model)", and model calls show "not measured". The rehearsal uses `data/rehearsal/` and never touches `data/app.db`.

**Repeatable recording:** while a paced rehearsal runs:

```bash
(cd ui && node scripts/live-shots.mjs screenshots/live-run --watch 55)   # same env as the running `app ui`
```

This captures one frame per second. Add `--video` for a .webm; it needs `npx playwright install ffmpeg`, which wasn't run here.

## Tests

| suite | what it runs against | result (dev box, Windows) |
|---|---|---|
| `python -m pytest -q -p no:cacheprovider` | backend, including 28 API tests | 163 passed, 2 skipped |
| `npm --prefix ui run test:e2e` | preview build, synthetic plus recorded files | 29 passed (58/58 over 2 repeats) |
| `npx --prefix ui playwright test -c playwright.live.config.ts` | **real** API + real rehearsal processes | 6 passed |

The live suite covers:
- event order matches audit order, and acting before approval is refused
- the state survives a page reload
- duplicate executes don't duplicate steps
- host-CLI approvals and skill promotion appear on screen
- the learned skill handles Act 2
- before/after shows "not measured" for model calls
- the operator API is killed: a stale-data banner appears, then the console recovers
- failed verification with an agent-service restart shows Needs review and the failing check
- phone width: no horizontal scroll, axe finds no serious issues
- only GET requests, and nothing leaves the origin (offline)
- a used login link is refused, and the session survives an API restart
- restoring an older DB mid-viewing resyncs the console instead of mixing histories
- the approve commands are executed exactly as copied from the page

## GB10: switching from mock records to the real agent (no UI change)

The console doesn't know or care who made the tool calls. It reads `tasks.mode` (`real` vs `mock`) and `tasks.model`
(from `data/model_probe.json`). The real pipeline is the runbook's gates, unchanged:

```bash
# on the GB10, after Gate 1 (vLLM up) and Gate 2 (serve on $BRIDGE, policy, records-ops skill installed)
LLM_BASE_URL=http://127.0.0.1:8000/v1 LLM_API_KEY=$(cat ~/.nemoclaw/dual-station-vllm-api-key) \
APP_SERVICE_URL=http://$BRIDGE:8765/call SANDBOX=$SANDBOX \
  nohup python3 -m app ui > data/ui.log 2>&1 &          # reads data/app.db, skills/, results/ (the gates' defaults)
python3 -m app ui --link                                 # one-time login link; from a laptop: ssh -L 8766:127.0.0.1:8766 gb10
python3 -m app models probe                              # so tasks record the served model
# Gate 3: task begin --mode real; OpenClaw drives the tools; you approve on the host; the console shows each step
# Gate 4: skill approve (hidden suite on the host): the console shows the promotion
# Gate 5: bench --agent openclaw --db data/app.db --out results/gate5: Benchmarks shows the measured result.json
```

Local inference → OpenClaw tool calls → `serve` → `data/app.db` → `python -m app ui` → live console → `results/gate5/result.json`.
Status pills show the real inference, sandbox and service health once those env vars are set. Without them they say
"Not checked", never "Healthy".

**Offline:** `bash scripts/offline.sh stage` now also packs `ui/dist`, and `restore` unpacks it, so the GB10 needs no Node.
