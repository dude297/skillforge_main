# Security model

Scope: what the code in this repository enforces, how it was checked, and where the known gaps are. Everything
marked "tested" was tested on a Windows 11 x86_64 dev box without a GPU, with synthetic data and a MOCK agent.
**Isolation has not been verified on a GB10:** the GB10 live runs used the subprocess runner (Docker was
permission-denied for the GB10 user and the docker path fails closed), and the OnCall runs did not run under NemoClaw/OpenShell (installed on the GB10 on 2026-10-25, see Network exposure), so
the SkillForge egress policy was never exercised. Live-model results: [BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25). Design detail: [ARCHITECTURE.md](ARCHITECTURE.md)
sections C to E. Claims with their tests: [CLAIMS.md](CLAIMS.md).

## Trust model

| party | trusted for | not trusted for |
|---|---|---|
| Agent / model (OpenClaw in a sandbox, or the OnCall `--live` synthesis) | proposing fixes and drafting skill code | approving anything, grading its own work, choosing its permissions |
| Generated skill code | nothing until a person approves it; after approval, only to return proposals | writing state, network access, reading host files |
| Host CLI operator (a person) | approving actions and skills | being identified: the `--by` name is free text |
| Trusted host code (`app/`) | policy checks, execution, verification, hashing, audit | n/a (this is the trusted base) |

## Host-only approvals

- `approve`, `skill approve`, `skill reject`, `skill disable` and `skill rollback` are host CLI commands that take
  `--by <person>`. They are **not** agent tools: `decide_approval` is deliberately outside `AGENT_TOOLS`
  (`app/tools.py`), and over the host service they return `unknown_tool`.
- Approvers named `agent`, `system` or `policy` are rejected (`test_agent_cannot_approve`).
- Execution requires `status='approved'`; each action executes at most once (`UNIQUE(action_id)`); every state change
  writes an audit row naming the actor.
- The browser UI is read-only: `app/ui_api.py` binds to loopback, checks the `Host` header, uses a one-time login
  link and serves GET only. There is no approve button anywhere in the UI.

### `approval.kind`: `simulated` or `host_cli`

OnCall run records (`experiments/oncall_infer`) carry `approval.kind`:

- `simulated`: the `--by` text marks the approver as an agent or a test (the committed recording
  `ui/public/demo/oncall-run.recorded.json` was approved by a coding agent with
  `--by "recorded-sim (agent, not a human)"` in a throwaway registry).
- `host_cli`: approved through the host CLI by text that is not marked as an agent or test.

The UI counts only `host_cli` as a person's decision and fails safe on anything else.
**Names are not identity-verified.** Anyone with a shell on the host can type any name. `host_cli` means "a
command was typed at the host", not "this named person approved". Identity binding (OS user, signed approvals) is not
implemented.

## Immutable hashes and versions

- A sha256 of the skill's file tree is taken when it is tested, checked again at approval (`integrity_error` if the
  candidate changed in between) and checked on every run (`test_tampered_approved_skill_refused`).
- Skill versions are `UNIQUE(name, version)` with one active version; `rollback` and `disable` exist; nothing
  overwrites an approved version.
- The system writes `meta.json` with `allowed_operations: ["compute_proposals"]`; fields the agent supplies are
  ignored. A promoted skill only proposes; its proposals go through policy, approval and verification again.
- Domain verifiers are pinned (`verifiers/pins.json`) and refuse contexts they were not validated for.

## Sandbox for generated code

`app/skillforge.py` `sandbox()` runs skill code in a throwaway copy with a scrubbed environment and a **15 s timeout**.

| runner | flags | checked |
|---|---|---|
| `SKILL_RUNNER=subprocess` (default) | `python -I -B`, scrubbed env, temp copy, timeout; POSIX rlimits | dev box. **rlimits are not applied on Windows** |
| `SKILL_RUNNER=docker` | `--network none --read-only --cap-drop ALL --security-opt no-new-privileges`, user 65534, 512 MB memory and swap, 1 CPU, 64 pids, skill copy mounted read-only, killed on timeout | locally on the dev box with Docker Desktop only; **not run on the GB10** |

The static lint (AST import and call allowlist) is an early filter, not a security boundary. The runner is the
boundary.

### Runner, lint and hidden-suite secrecy

- **GB10 runs used the subprocess runner** (`python -I -B`, scrubbed env, rlimits CPU 10 s / AS 1 GiB / FSIZE 1 MiB /
  NOFILE 64), as reported by the GB10 operator. Docker was permission-denied for the GB10 user; the docker path fails
  closed and was not weakened.
- **Finding (GB10-side audit, fixed in commit `1094d95`).** The lint could be bypassed by aliasing a banned builtin
  (`o = open`) or by `operator.attrgetter`. Under the subprocess runner a hostile skill could then read the hidden
  suite from disk. The lint now rejects aliased banned builtins, dunder names and `operator.attrgetter`/`methodcaller`.
- **Attempt 4 is not affected.** The passing live candidate (skill tree sha256
  `7fe0c025039b11b93617ba63955f3fe9da0ec55c7e7a0ed11bbae3982fa3aa0e`) imports only `json` and `typing`, uses no file,
  attribute or dunder access, passes the hardened lint, and its hash is unchanged, so its 9/9 hidden result is not
  contaminated.
- **Residual.** The lint is not a security boundary. Under the subprocess runner the hidden suite is readable by
  skill code that evades the lint; keeping it secret from a hostile skill needs the Docker runner.
  The approver identity (`--by`) is not authenticated. With the `--local` fallback package the DB and tools run inside the agent sandbox and the agent has `exec`,
so the guarantees above hold only for paths through the tool interface
([SKILLFORGE.md §11](SKILLFORGE.md#11-trust-boundary-v2-trusted-service-outside-the-sandbox)).

## Network exposure

- The host tool service refuses to bind `0.0.0.0`, `::` or an empty address (`app/server.py`); it is meant to be
  reached from the sandbox at `host.openshell.internal` with a bearer token that authorizes only the agent tool set.
- The operator console binds `127.0.0.1` (default port 8766).
- The OpenShell egress preset (`adapters/openclaw/presets/host-tools.yaml`) allows only POST `/call` to the host
  service. **Not verified on a real OpenShell runtime** (OpenShell 0.0.116 is installed on the GB10; this preset has not been exercised).
- GB10 sandbox `skillforge` (operator report): the only network policy is `telegram_bot` (`api.telegram.org:443`, rest, enforce); inference goes to the local model as `https://inference.local`. OpenClaw's own telemetry (`telemetry.openclaw.ai:443`) was DENIED by the restricted tier. Verified in OpenShell OCSF logs for one Telegram <-> local model round trip only; a non-allowlisted-sender check and a full egress review are **not done**. See [integrations/telegram/telegram_setup.md](../integrations/telegram/telegram_setup.md) and [integrations/telegram/GAPS.md](../integrations/telegram/GAPS.md).
- **Exception to the no-0.0.0.0 rule.** NemoClaw's auth proxy listens on `0.0.0.0:11435` (token-protected, 401 without the token; hard-coded at `scripts/ollama-auth-proxy.mts:478`, not configurable). The rule binds SkillForge's own services (`app/server.py` still refuses `0.0.0.0`); this third-party listener conflicts with its intent. Proposed mitigation: UFW allow loopback and 172.18.0.0/16 to 11435, deny the rest. **Not applied; pending operator decision.** Other new listeners are loopback/bridge only (127.0.0.1:8080 gateway, 127.0.0.1:18789 dashboard, 172.18.0.1:8080).
- The agent tool allowlist is fixed in code (`AGENT_TOOLS`). These isolation settings must not be weakened to make a
  check pass.

## Incident fingerprint and the core matcher gap

OnCall reuse (INC-2) and refusal (INC-3) depend on two layers:

1. The **core structural matcher** (`match_skills`) compares a signature of shape, kinds, sources, writable fields
   and invariants. INC-3 (disk full, a lookalike) has the same JSON shape as INC-1, so **core reports `exact`**.
   This is a known false-exact gap, pinned by `test_core_matcher_false_positive_on_lookalike_is_a_known_gap`.
2. The **OnCall incident fingerprint** (exception type, component, failure category, top frames) is stored on the
   approved skill's registry row (`skills.validation.incident_fingerprint`). The OnCall reuse path refuses when it
   differs, and **fails closed** when it is missing or tampered with (`test_missing_or_tampered_fingerprint_refuses_reuse`).

How the gap is contained: core reuse paths (`app/ops.py`, `app/skillforge.py`, `app/bench.py`, `experiments/router`)
do not consult the fingerprint. A direct core `run_skill` on INC-3 still proposes nothing, because approval re-runs
the hidden suite, whose lookalike cases force any approvable skill to return no proposal for INC-3
(`test_core_path_bypass_yields_no_proposal`). Even a wrong proposal would still need a person's approval and would be
re-verified. Closing the gap properly needs a core change (fingerprint in the core signature); none was made, because
the core is frozen except for blockers.

The reuse path also runs with a `NoModel` guard that counts any attempt to build a model client and raises, so
`model_calls: 0` is enforced, not just reported.

## Secrets

- No secrets are in this tree (grep-based scan; see [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md#part-3-tests-on-this-tree)).
- `data/.agent_token`, `data/.operator_token`, `.env*` and runtime databases are gitignored.
- `deploy/gb10/sf-gb10.sh` reads the vLLM API key from a file into `LLM_API_KEY` and never prints it.
- `deploy/gb10/make_bundle.sh` refuses to build if the bundle contains this machine's hostname, git email or a
  Windows user-profile path (read at run time, not written into the script).

## Reporting a vulnerability

This is a hackathon prototype with no production deployment. Please do **not** open a public issue for a security
problem. If the repository is published, use GitHub's private vulnerability reporting ("Security" tab, "Report a
vulnerability") on the repository. Include the commit, the steps to reproduce and the impact. There is no bug bounty
and no response-time commitment.
