# SkillForge: 3-minute judge pitch

Rules for the speaker: say only what the table at the end supports. GB10 approval, reuse and refusal are done (section 3 of `docs/BENCHMARKS.md`); say them with their caveats (subprocess runner, `--by` name unverified, n=6). Never read a recorded number as a GB10 number. GB10 figures and their sha256: `docs/BENCHMARKS.md` section 3.

## Full version (~420 words, 3:00)

### 0:00-0:30 Problem
On-call teams for inference services see the same incidents again and again: a deploy raises `max_num_seqs` or `max_model_len`, the GPU runs out of memory, and the gateway starts returning 429s. An LLM agent can diagnose that. But a typical agent calls the model again on every recurrence. That costs time, GPU and tokens each time, and nobody has checked the code it produces, so you can't trust it to run on its own.

### 0:30-1:10 Solution
SkillForge turns one good diagnosis into a reusable program. On the first incident, a local model writes a small diagnostic skill: Python code plus its own tests. The host then checks it independently: a static lint, the skill's own tests, a replay of the original incident, a capacity check, and a hidden suite of nine cases that the model never sees. Even if it passes, it can't run yet. A person must approve it on the host command line. The browser is read-only.

### 1:10-1:50 What's new
After approval the skill is immutable, pinned by its sha256. The next compatible incident is handled by that fixed code, with **zero model calls**. A guard counts any model call, and the run fails if there is one. A lookalike incident is refused rather than guessed: a disk-full error that superficially matches the same structure. The incident fingerprint (exception type, component, failure category, top frames) differs, so reuse fails closed. So the model's output becomes an approved, versioned artifact. Recurring incidents are not answered by another round of model inference.

### 1:50-2:20 Why the GB10
Synthesis runs on a local model, Qwen3.6-35B-A3B in NVFP4, served by vLLM on the GB10. The design keeps the logs, configs and code on the box; NemoClaw/OpenShell is not installed on the GB10 and the egress policy was never exercised, so do not say "never leaves" and do not say it ran in NemoClaw. The GB10's 128 GB unified memory holds a 35B mixture-of-experts model next to the sandbox, the verifier and the console on one desk-side machine.

### 2:20-3:00 Results (only what we measured)
- Hidden suite: 9/9 cases pass, but for the **hand-written reference skill**, not model output (recorded run).
- Reuse of INC-2: 0 model calls, enforced by the guard; 256 ms for match plus deterministic execution, on a Windows dev box. That is not a saving in inference time: the recorded first run made no model call to compare against.
- INC-3 lookalike: refused by the fingerprint check.
- Live synthesis on the GB10 (Qwen3.6-35B-A3B, subprocess runner): with the original prompt 0 of 3 attempts passed. After a **disclosed** prompt revision made once the operator saw a 7/9 result, one attempt passed the hidden suite 9/9 (1 model call, 173.0 s, 12,763 completion tokens) and an identical repeat scored 8/9 and was rejected. Say "1 of 2", never "it works". Every failing candidate was rejected by the verifier; none staged. The passing skill is staged as `tested`, proposal only.
- On the GB10 a person (the operator) approved that skill on the host CLI (`--by` name not identity-verified). INC-2 was then reused with **0 model calls**, 27.0 ms (6 fresh-process trials: p50 28.2 ms, max 42.1), and vLLM request counters did not move. INC-3 was refused by the incident fingerprint every time. Scope: reuse decision plus sandboxed run in the subprocess runner (no Docker isolation). Do not present 28 ms as a speed-up over the 173.0 s synthesis call; they are different scopes.
- Per-request streaming (not aggregate throughput), 0 of 70 requests failed: TTFT p50 0.0623 s (c=1), 0.1087 s (c=2), 0.1026 s (c=4); decode p50 75.63 / 61.83 / 55.27 tok/s; min free memory 62.78 GiB; peak 62 C and 42.07 W.
- Security caveat if asked: the GB10 runs used the subprocess runner, the lint is not a boundary (a bypass was found and fixed), and hidden-suite secrecy needs the Docker runner.

Close: "Fix it once with the model, verify it independently, let a person approve it, then reuse it without the model, and refuse what only looks similar."

## 60-second emergency version
"Inference on-call teams keep seeing the same incidents, and agents call the LLM again every time with unverified code. SkillForge has a local model on the GB10 write a small diagnostic skill once. The host verifies it with lint, the skill's own tests, a replay and a hidden suite the model never sees. A person approves it on the host. After that, the next matching incident runs the pinned skill with zero model calls, and a lookalike incident is refused, not guessed. On the dev box: 0 model calls on reuse, enforced by a guard, and the lookalike refused. On the GB10, Qwen wrote a skill that passed the hidden suite 9/9 on its first try with our revised prompt; an identical repeat scored 8/9 and was rejected, and approval and reuse on the GB10 are still pending."

## Where every number comes from
| Claim | Source | Status |
|---|---|---|
| 9 hidden cases, 9 pass | `ui/public/demo/oncall-run.recorded.json` `verification.hidden`; cases in `experiments/oncall_infer/hidden/oncall_infer_hidden.py` | real, dev box, **reference skill (hand-written)** |
| 0 model calls on reuse | same file `reuse.model_calls`; `NoModel` guard in `experiments/oncall_infer/oncall.py` | real, dev box |
| 256 ms reuse | same file `reuse.latency_ms` (other dev-box runs ~117-256 ms, not committed) | real, dev box, Windows, not GPU |
| INC-3 refused | same file `refusal.reason` | real, dev box |
| Recorded approval | same file `approval.kind = "simulated"`, `by = "recorded-sim (agent, not a human)"` | simulated, **not a person** |
| 128 GB unified memory | `docs/GB10_FRONTIER.md` §memory | spec, not measured |
| Model id | served as `skillforge-qwen` (Qwen3.6-35B-A3B-NVFP4), per the GB10 operator's report | reported, GB10 |
| Live synthesis attempt 4: hidden 9/9, 1 call, 173.0 s, 12,763 completion tokens; attempt 5: 8/9 rejected; original prompt 0/3 | `docs/evidence/gb10/attempt4-oncall-run.json` sha256 `712dbf78...4b58` and `attempt5-oncall-run.json` sha256 `f95121b0...e01d` (sanitized records, see `docs/evidence/gb10/README.md`); attempts 1-3: operator report only. Attempt 5 failed because the model ignored an explicit prompt instruction (`not_applicable` instead of `requires_review`) | real, GB10, disclosed prompt revision |
| TTFT, decode, memory, temperature, power | frontier report sha256 `6890165aa86abbb7834ec2aa15784bbf6326104363466d786b0fd66d4e8d23e2` (file on the GB10/SSD) | real, GB10, per request |
| Person's approval (`host_cli`, 20:25:02Z); GB10 INC-2 reuse 0 model calls, 6 trials p50 28.2 ms; INC-3 refused | `docs/evidence/gb10/reuse-oncall-run.json` (sha256 in `docs/evidence/gb10/README.md`); GB10 original sha256 `1e32985e...6d2`; vLLM counters unchanged | real, GB10, subprocess runner, `--by` unverified |
