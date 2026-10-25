# Limitations

Each claim and its evidence: [CLAIMS.md](CLAIMS.md). Security gaps in detail:
[SECURITY.md](SECURITY.md).

## Evidence

- **The committed OnCall recording is still a `RECORDED_SIMULATION`**: its skill was hand-written by a coding agent,
  and its approval was typed by an agent (`approval.kind: simulated`). Do not read it as the GB10 result.
- **GB10 live synthesis is not reliable.** Qwen wrote a skill that passed the 9-case hidden suite once (9/9) and failed
  the identical repeat (8/9); with the original prompt 0 of 3 attempts passed. The prompt was revised by the operator
  after seeing the 7/9 result (disclosed, evidence-sufficiency rule). A later evaluation (current serving config,
  committed prompt, scratch states, nothing staged or approved, timings contended) passed 3 of 7 with thinking on and
  0 of 1 with thinking off; 4 of 9 pooled with attempts 4 and 5. All five failures were hidden 8/9 on one case
  (`not_applicable` instead of `requires_review`); the verifier rejected every one. The prompt is not revised
  further, because the case name is known and a change would teach to the test. Generation is not reliable enough for
  unattended use; the verifier plus human approval is what makes it safe. Output is not deterministic at temperature 0
  on this vLLM. See [BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25).
- **GB10 approval and reuse: done, with caveats.** A person (the operator) approved the passing skill on the GB10 host CLI; the `--by` name is not identity-verified. INC-2 reuse made 0 model calls (6 trials, p50 28.2 ms, min 27.0, max 42.1) and INC-3 was refused every time, all in the subprocess runner (no Docker isolation). n=6, one skill. There is no GB10 first-time-vs-reuse speed-up claim (different scopes: 173.0 s model call vs ~28 ms with 0 model calls). GPU telemetry for the passing run was not captured.
- **Docker follow-up (after the runs above).** The GB10 Docker path first failed closed on every run (the 0700 temp dir was unreadable by the container's uid 65534; fixed in this release, `tests/test_docker_runner.py`). With the fix, the approved attempt-4 skill was re-verified on a copy with `SKILL_RUNNER=docker` (`--network none`, read-only, 512 MB, 1 CPU, pids 64, no capabilities, uid 65534, only the skill copy mounted, so the hidden suite is unreachable): hidden 9/9, regression 5/5, same hash `7fe0c025...` (GB10 evidence `docker-reverify.json`, sha256 `4b7d54fd1cbd3462ce8a3b5d0127c9113152edfc51fbb58c2a8a790717148f02`, not committed). INC-2 reuse under Docker: 0 model calls, 275.5 ms (container start-up included), INC-3 refused. The original attempt-4 verification and the 6 timed reuse trials still ran in the subprocess runner.
- **GB10 evidence files are not in this repository.** Numbers are the GB10 operator's report plus the sha256 of the files
  on the GB10/SSD; they are not independently reproducible from this tree.
- **Decode tok/s is per request only.** The frontier harness runs C parallel copies of a single-request probe; it
  does not measure aggregate server throughput.
- All data (OnCall incidents, freight records) is synthetic, and the message channel is simulated (no Slack or
  Telegram in this tree's SkillForge code). A Telegram <-> local model round trip was verified on the GB10 through NemoClaw/OpenShell ([CLAIMS.md](CLAIMS.md) #26); OpenClaw -> SkillForge host tools was verified separately (Gate 2, records-ops tools; CLAIMS #23c), but a single Telegram message driving SkillForge tools end to end is not recorded.
- Tests, replay and hidden suites are evidence, not a formal proof that a skill is correct.
- The reuse latency (about 117–256 ms) is a dev-box measurement of match plus deterministic execution, not an
  inference saving.

## Security and correctness

- **Core matcher gap.** Core `match_skills` reports the OnCall lookalike INC-3 as an `exact` match. The refusal comes
  from the experiment's incident fingerprint; core reuse paths do not consult it. A direct core `run_skill` is
  contained by the hidden suite's lookalike cases. Fixing it needs a core change ([SECURITY.md](SECURITY.md#incident-fingerprint-and-the-core-matcher-gap)).
- **Approver identity is not verified.** `--by` is free text; `approval.kind: host_cli` means a command was typed on
  the host, not that the named person approved.
- The subprocess runner's rlimits are not applied on Windows. Docker isolation was checked only on the dev box.
- **GB10 runs used the subprocess runner**, not Docker (Docker was permission-denied for the GB10 user; the docker path
  fails closed). **The skill lint is not a security boundary** (a bypass by aliasing and `operator.attrgetter` was found
  and fixed in `1094d95`); under the subprocess runner a hostile skill could read the hidden suite from disk, so hidden-suite
  secrecy needs the Docker runner ([SECURITY.md](SECURITY.md#runner-lint-and-hidden-suite-secrecy)).
- **Gate 2 passed (OpenClaw in the sandbox -> SkillForge host tools, records-ops tools only), but the OnCall loop has not run under NemoClaw/OpenShell/OpenClaw.** The OnCall runs used the host harness, under the earlier serving config (0.4 / 32k / 4 seqs). The `host-tools` policy was applied and exercised for the records-ops round trip; no negative test is recorded. Not verified: OpenClaw driving OnCall synthesis/verification (Gate 3: pipeline verified end to end, no candidate passed the independent verifier, 0 accepted; [CLAIMS.md](CLAIMS.md) #23b), Telegram -> SkillForge tools in one end-to-end message, a non-allowlisted-sender check, a full egress review. See [CLAIMS.md](CLAIMS.md) #23c, [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md) and [integrations/telegram/GAPS.md](../integrations/telegram/GAPS.md).
- **Serving change is a capacity change, not a speed change.** Single-stream decode is unchanged (73.8 tok/s at c=1, thinking off, current config vs 75.6, earlier config). The thinking-on c=4 decode drop (34.0 tok/s) is unexplained and was not re-run. Nemotron was stopped after 0/2 on OnCall; Qwen-only numbers are UNCONTENDED.
- **NemoClaw's auth proxy listens on `0.0.0.0:11435`** (token-protected, 401 without the token; hard-coded in NemoClaw `scripts/ollama-auth-proxy.mts:478`, not configurable). Mitigation proposed (UFW allow lo and 172.18.0.0/16 to 11435, deny the rest), **not applied**; awaiting an operator decision.
- **Nemotron has not produced a passing skill.** Attempts 3 and 6 failed (0 of 2); attempt 6 hit `max_tokens` 32000 while reasoning with no answer (a thinking-budget problem).
- **Incident, 2026-10-25.** The first `channels add telegram` rebuild deleted the original sandbox `my-assistant` (the non-interactive recreate lacked `NEMOCLAW_COMPATIBLE_AUTH_MODE=none`). Fixed in `integrations/telegram/telegram-setup.sh`; recreated as `skillforge`; vLLM untouched.
- **Hosted preview is not the product.** https://skillforge-ui-lab.vercel.app is read-only with recorded data and no backend calls.
- With the `--local` fallback package, the agent has `exec` inside the sandbox, so guarantees hold only through the
  tool interface.

## Reliability

- **15 s core sandbox timeout.** Skill tests and hidden checks run under core's 15 s timeout. Under heavy load (for
  example while the GPU serves a model), verification can time out and the candidate is rejected rather than passed.
  Re-run when idle; raising the timeout is a core change.
- **Flaky tests seen under load** on the dev box: `tests/test_faults.py::test_restore_checkpoint_and_resume_interrupted_workflow`
  and `::test_corrupt_backup_is_not_restored` (each passed when re-run alone), and once
  `experiments/oncall_infer/test_oncall_infer.py::test_after_approval_inc2_reused_with_zero_model_calls_and_inc3_refused`
  (`ToolError` at `app/skillforge.py:748`; passed on re-run). Causes not investigated.
- Single workspace, single open task (`scripts/unified.py`).
- **Screenshots under `ui/screenshots/` come from earlier builds** and are not evidence. Some show copy that was later
  removed because it overstated what is verified (for example the status bar text "Live reads the GB10", which
  the current UI replaces with "Live reads this machine"). Trust the current UI source and the recorded JSON, not the older images.

## Launchers and UI

- `start-demo.ps1` / `start-demo.sh` were verified on Windows only. `start-demo.sh` has not been run on Linux or
  macOS (on the GB10 it is reached via `sf-gb10.sh demo`; this tree has no record of that being run).
- Stopping with **Ctrl-Break** was tested; a real **Ctrl-C** was not.
- Without `ui/node_modules`, the launcher runs `npm ci`, which needs network access.
- The UI suites (mock e2e 78/78, lint, typecheck, build) were reported by the owner's session and not re-run on the
  public tree.

## Scope

- Several components live under `experiments/` and are not imported by the core (router, catalog, OnCall, GB10
  harness).
- GPU-aware scheduling and model sleep/wake are proposals only.
- Team members and per-person contributions are not recorded in git.
