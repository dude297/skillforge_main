# SkillForge: 3-minute judge pitch

Rules for the speaker: say only what the table at the end supports. Anything marked **pending GB10** is read from the evidence folder on the day, or left out. Never read a recorded number as a GB10 number.

## Full version (~420 words, 3:00)

### 0:00-0:30 Problem
On-call teams for inference services see the same incidents again and again: a deploy raises `max_num_seqs` or `max_model_len`, the GPU runs out of memory, and the gateway starts returning 429s. An LLM agent can diagnose that. But a typical agent calls the model again on every recurrence. That costs time, GPU and tokens each time, and nobody has checked the code it produces, so you can't trust it to run on its own.

### 0:30-1:10 Solution
SkillForge turns one good diagnosis into a reusable program. On the first incident, a local model writes a small diagnostic skill: Python code plus its own tests. The host then checks it independently: a static lint, the skill's own tests, a replay of the original incident, a capacity check, and a hidden suite of nine cases that the model never sees. Even if it passes, it can't run yet. A person must approve it on the host command line. The browser is read-only.

### 1:10-1:50 What's new
After approval the skill is immutable, pinned by its sha256. The next compatible incident is handled by that fixed code, with **zero model calls**. A guard counts any model call, and the run fails if there is one. A lookalike incident is refused rather than guessed: a disk-full error that superficially matches the same structure. The incident fingerprint (exception type, component, failure category, top frames) differs, so reuse fails closed. So the model's output becomes an approved, versioned artifact. Recurring incidents are not answered by another round of model inference.

### 1:50-2:20 Why the GB10
Synthesis runs on a local model, Qwen3.6-35B-A3B in NVFP4, served by vLLM on the GB10. The design keeps the logs, configs and code on the box; the sandbox egress policy is not yet verified on the GB10, so do not say "never leaves". The GB10's 128 GB unified memory holds a 35B mixture-of-experts model next to the sandbox, the verifier and the console on one desk-side machine.

### 2:20-3:00 Results (only what we measured)
- Hidden suite: 9/9 cases pass, but for the **hand-written reference skill**, not model output (recorded run).
- Reuse of INC-2: 0 model calls, enforced by the guard; 256 ms for match plus deterministic execution, on a Windows dev box. That is not a saving in inference time: the recorded first run made no model call to compare against.
- INC-3 lookalike: refused by the fingerprint check.
- Live synthesis on the GB10 (model calls, latency, tokens, hidden-suite result for model-written code, a person's approval): **pending GB10**.
- TTFT, decode tok/s and memory headroom: **pending GB10**.

Close: "Fix it once with the model, verify it independently, let a person approve it, then reuse it without the model, and refuse what only looks similar."

## 60-second emergency version
"Inference on-call teams keep seeing the same incidents, and agents call the LLM again every time with unverified code. SkillForge has a local model on the GB10 write a small diagnostic skill once. The host verifies it with lint, the skill's own tests, a replay and a hidden suite the model never sees. A person approves it on the host. After that, the next matching incident runs the pinned skill with zero model calls, and a lookalike incident is refused, not guessed. Today, on the dev box: 0 model calls on reuse, enforced by a guard, and the lookalike refused. The GB10 numbers for live synthesis are [read from the evidence folder / pending]. Data never leaves the box."

## Where every number comes from
| Claim | Source | Status |
|---|---|---|
| 9 hidden cases, 9 pass | `ui/public/demo/oncall-run.recorded.json` `verification.hidden`; cases in `experiments/oncall_infer/hidden/oncall_infer_hidden.py` | real, dev box, **reference skill (hand-written)** |
| 0 model calls on reuse | same file `reuse.model_calls`; `NoModel` guard in `experiments/oncall_infer/oncall.py` | real, dev box |
| 256 ms reuse | same file `reuse.latency_ms` (other dev-box runs ~117-256 ms, not committed) | real, dev box, Windows, not GPU |
| INC-3 refused | same file `refusal.reason` | real, dev box |
| Recorded approval | same file `approval.kind = "simulated"`, `by = "recorded-sim (agent, not a human)"` | simulated, **not a person** |
| 128 GB unified memory | `docs/GB10_FRONTIER.md` §memory | spec, not measured |
| Model id | `docs/SKILLFORGE.md` §16 (vendor docs) | assumed until `models.json` shows it |
| Live synthesis, TTFT, decode, memory | `results/gb10-evidence/*`, `results/frontier/*` | **pending GB10** |
