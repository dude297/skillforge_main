# SkillForge

**A local AI runtime that turns an independently verified, human-approved fix into an immutable skill, then reuses
that skill deterministically instead of making another model call.**

Repository: `<REPO_URL>`. Hosted preview (read-only, recorded data, no backend calls): https://skillforge-ui-lab.vercel.app

## What it is

A local model solves an operations problem once. Trusted code lints the skill it drafts, runs its tests in an isolated
runner, replays the approved fix and runs a hidden suite the model never sees. A person promotes the skill on the host
CLI (the agent has no approve tool and the UI is read-only); the file tree is sha256-pinned and versioned. The next
matching incident runs that fixed code with no model client constructed, and lookalikes are refused with a typed reason.
This is a design claim; it is not benchmarked against other agent-memory approaches.

OnCall demonstration (`experiments/oncall_infer/`, synthetic data): INC-1 (a deploy raised `max_num_seqs`, CUDA OOM, 429s)
yields a skill; INC-2 (same class, other key) is reused with `model_calls: 0`; INC-3 (disk full, a lookalike) is refused
by the incident fingerprint.

## Status (2026-10-25)

Verified, with evidence in [docs/CLAIMS.md](docs/CLAIMS.md) (claims table, then results and limits) and
[docs/evidence/gb10/](docs/evidence/gb10/README.md):

- **Dev box (Windows 11, no GPU, MOCK agent, synthetic data):** approval gate, execute-once, re-reading verifier, skill lint,
  sandboxed tests, replay, hidden suite, sha256 pinning, rollback, deterministic reuse, fingerprint refusal, guided demo and
  console. The committed demo recording is a `RECORDED_SIMULATION` (hand-written reference skill, approval typed by an agent).
- **GB10 (Dell Pro Max, vLLM 0.21.0, Qwen3.6-35B-A3B-NVFP4 as `skillforge-qwen`):** frontier bench (70 requests, 0 errors;
  TTFT p50 0.058 to 0.109 s, decode 55 to 76 tok/s per request across c=1/2/4 and both serving configs).
- **Current GB10 serving (`qwen-solo-mtp`: gpu-memory-utilization 0.60, 131072 context, 16 seqs, async scheduling, MTP speculative decoding):** a quick probe (not the frontier harness, so not comparable to the figures above) shows c=1 decode 89.6 to 91.2 tok/s versus 72 to 74 on the previous config; post-restart sanity PASS (approved skill intact, INC-2 reuse 0 model calls, INC-3 refused). The OnCall attempts and the 3 of 7 evaluation ran under earlier configs.
- **GB10 live OnCall:** the model wrote a skill that passed the hidden suite 9/9 (attempt 4); a person approved it on the host
  CLI; INC-2 was reused with 0 model calls (6 trials, p50 28.2 ms, subprocess runner) and INC-3 was refused every time.
- **Generation is not reliable.** Original prompt 0 of 3; after one disclosed prompt revision 1 of 2; a later evaluation on
  the current serving config passed 3 of 7 with thinking on and 0 of 1 off (4 of 9 pooled with attempts 4 and 5). All
  failures were the same hidden case; the verifier rejected every one. Safety comes from the verifier plus human approval.
- **NemoClaw v0.0.137 / OpenShell 0.0.116 / OpenClaw v2026.9.2 on the GB10:** sandbox `skillforge`; Telegram <-> local model
  round trip verified; Gate 2 GO (13/13), an OpenClaw agent called SkillForge records-ops host tools through the applied
  `host-tools` policy.

Not verified: OpenClaw-driven OnCall synthesis (Gate 3: pipeline verified end to end, no candidate passed the independent
verifier, 0 accepted), a single Telegram message driving SkillForge tools, a non-allowlisted-sender check, a full egress
review, GPU/power/token savings, any speed-up claim for reuse versus synthesis (different scopes). The timed GB10 runs used
the subprocess runner (Docker re-verification of the approved skill ran on a copy); `--by` approver names are not
identity-verified; NemoClaw's auth proxy listens on `0.0.0.0:11435` (token-protected, disclosed exception, mitigation
proposed and not applied). All data is synthetic.

## Run it

Dev box (Python >= 3.11 stdlib only; Node for the UI):

```bash
./start-demo.ps1 --no-open            # Windows PowerShell
bash start-demo.sh --no-open          # Linux, macOS, Git Bash (verified on Windows only)
python -m app demo --yes              # mock plumbing, labelled MOCK
python -m pytest -q -p no:cacheprovider tests/test_contracts.py experiments/oncall_infer/test_oncall_infer.py experiments/gb10_bench
```

Open the printed one-time login link, then `http://127.0.0.1:8766/#/demo` (guided six-scene demo) or
`#/console/investigations/incident`. OnCall from the CLI: `python -m experiments.oncall_infer run`, a person types the
printed `skill approve ... --by "<name>"`, then `python -m experiments.oncall_infer reuse`.

GB10: `bash deploy/gb10/sf-gb10.sh preflight | oncall | reuse | bench | demo`; procedure, gates, demo route and evidence method in
[docs/GB10_RUNBOOK.md](docs/GB10_RUNBOOK.md).

## Docs

- [docs/CLAIMS.md](docs/CLAIMS.md): every claim with its evidence, plus measurements and limitations
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it works and the security model
- [docs/GB10_RUNBOOK.md](docs/GB10_RUNBOOK.md): GB10 setup, gates, demo route, evidence protocol
- [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md): present state, then history
- [moonshot_ui.md](moonshot_ui.md): UI spec; [integrations/telegram/](integrations/telegram/telegram_setup.md): Telegram setup and gaps

## Team, licence

Members are not recorded in git; commits carry a team identity. Dell Technologies, NVIDIA (GB10, NemoClaw, OpenShell,
Nemotron), vLLM, OpenClaw, the Qwen team and the open-source UI libraries are acknowledged; see [LICENSE](LICENSE).
Claude Code was used to write code and documentation (`Co-Authored-By: Claude` trailers). MIT, Copyright (c) 2026 the
SkillForge team.
