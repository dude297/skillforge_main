# Reliability risks (OnCall live path + skill registry)

Verified offline with `experiments/oncall_infer/test_reliability.py` (loopback stub only; no GB10/vLLM contact).

## Fixed in experiments/ (reproduced, then fixed)
1. A strict `--live` run that failed during synthesis (endpoint healthy, model reply unusable) had already wiped the
   previous registry/state dir, although the CLI promises "nothing written". Now the old state is kept as `<state>.prev`
   and restored on failure.
2. `oncall.reuse` crashed with a traceback when core refused to run the approved skill (tampered artifact,
   `integrity_error`) and left the saved artifact saying "awaiting approval". It now records a refusal with core's reason.

## Verified holding (no change needed)
INC-1/INC-2 fingerprints equal, INC-3 differs; untrusted or other-record evidence cannot move a fingerprint; non-human
approvers (agent/system/policy/blank/non-str) fail closed; agent tool dispatch has no approve path; tampered candidate,
tampered/extra file in the approved dir are rejected; approved copy is independent of the candidate; double approval and
double decision are invalid_state with provenance kept; repeated propose does not duplicate open actions; `--live`
(bad reply, 500, wrong model id, timeout, unreachable) raises LLMUnavailable, exit 2, writes nothing; an overfit live
skill fails the hidden suite and is not staged; a runaway skill gets "timeout after Ns".

## Remaining risks, ranked
1. **Approver identity is a typed string.** `approval.kind=host_cli` only means "not marked as an agent"; `--by alice`
   typed by an agent with host shell access is indistinguishable. `_human()` blocks only agent/system/policy.
   Mitigation is operational (agent has no host shell); not fixable in the registry.
2. **Core structural matcher accepts INC-3** (known gap). Protection depends on `oncall._decide` (fingerprint) and on the
   hidden suite run at approval. Any caller using core `match_skills` alone is not protected.
3. **Sandbox on the Windows dev box has no rlimits** (`preexec_fn` is POSIX only); only the wall-clock timeout applies.
   The GB10 run must use `SKILL_RUNNER=docker` or Linux rlimits for memory/CPU bounds.
4. **`meta.json` is excluded from the artifact hash**, so `approved_by` in meta can be edited without detection. The
   authoritative provenance is the DB row and audit table, not meta.json.
5. **Live synthesis timeout is fixed at 300 s per call, 2 attempts** (up to ~10 min before a loud failure). Acceptable
   but slow to fail on event day if the endpoint hangs after /models answers.
6. **`oncall.run()` default is `allow_fallback=True`** (the CLI passes False for `--live`). Library callers must pass
   `allow_fallback=False`; the output is always labelled RECORDED_SIMULATION when it falls back.
7. Running `pytest experiments/oncall_infer` (directory) also collects `reference_skill/tests` and errors on `import helper`;
   run the explicit test files.
