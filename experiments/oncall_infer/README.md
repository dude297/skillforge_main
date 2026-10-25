# OnCall learning loop: synthetic inference-serving incident (EXPERIMENT)

All three incidents are SYNTHETIC and hand-written (`fixtures/`):
- INC-1: `max_num_seqs` 128 -> 1024, so the GPU runs out of memory and the gateway returns 429s.
- INC-2: same failure class, but a different service and key (`max_model_len`).
- INC-3: a lookalike. The disk is full (ENOSPC) and the config did not regress.

`python experiments/oncall_infer/fixtures/capacity_check.py` reproduces the failing check.

## Flow
1. `run`
   - A: the model writes the skill.
   - B: core runs lint, the skill's own tests, an INC-1 replay and the capacity check, then the hidden suite through `skillforge.hidden_check`. The hidden suite in `hidden/` is never put in a prompt.
   - C: the candidate is staged in core's registry as `tested`, and the run stops at `pending`.
2. A person runs the printed core command, `python -m app skill approve ... --by NAME`. The script never approves.
3. `reuse` (D)
   - INC-2 goes through core `match_skills` + `run_skill`. A model client is never built: `NoModel` counts any attempt and raises.
   - INC-3 is refused. Core's structural matcher says it is exact, but the section-17 incident fingerprint (exception type, component, failure category, top frames) differs.

## GB10 live run (repo root, model served by vLLM)
```bash
python -m experiments.oncall_infer run --live --base-url http://127.0.0.1:8000/v1   # --model auto (default) = served id from /v1/models
# --live fails loudly (exit 2, nothing written) on any model failure; --allow-fallback opts into a labelled RECORDED_SIMULATION
# a PERSON types the printed command, e.g.
APP_DB="data/unified/demo/oncall/app.db" SKILLS_DIR="data/unified/demo/oncall/skills" \
  HIDDEN_DIR="experiments/oncall_infer/hidden" python -m app skill approve oncall-serving-config-revert 1 --by "Jane Doe"
python -m experiments.oncall_infer reuse
```
The run writes `data/unified/demo/oncall-run.json`. `GET /ui/demo/oncall` serves that file, or falls back to the recorded file below (`route.py`, installed by `scripts/unified.py console`).

What gets measured:
- `model_calls`: the number of chat requests sent. `LLM_RETRIES=0`, so retries cannot hide calls.
- Tokens: recorded only when the server returns `usage`. Otherwise they stay null.
- If the endpoint is unreachable, the run falls back to the reference skill and is labelled `RECORDED_SIMULATION`.

## Recorded artifact (`ui/public/demo/oncall-run.recorded.json`)
- The skill is `reference_skill/`. An agent wrote it by hand; it is not model output.
- An agent typed the approval into a THROWAWAY registry with `--by "recorded-sim (agent, not a human)"`. The JSON says so in `approval.by`, `approval.kind = "simulated"` and `model.note`.
- Reuse latency in this file is a single local measurement on a Windows dev box: core match plus deterministic helper execution, no model. It is **not** an end-to-end inference saving. The first run made no model call to compare against, so its model fields are null.

To regenerate it:
```bash
T=$(mktemp -d); OUT=ui/public/demo/oncall-run.recorded.json
python -m experiments.oncall_infer run --state "$T" --out $OUT
APP_DB="$T/app.db" SKILLS_DIR="$T/skills" HIDDEN_DIR=experiments/oncall_infer/hidden \
  python -m app skill approve oncall-serving-config-revert 1 --by "recorded-sim (agent, not a human)"
python -m experiments.oncall_infer reuse --state "$T" --out $OUT
sed -i "s#$T#<throwaway-tmp-registry>#g" $OUT
# Git Bash on Windows prints the temp dir as C:/Users/.../tmp.XXXX, which the sed above misses:
python -c "import re,sys,pathlib;p=pathlib.Path(sys.argv[1]);p.write_bytes(re.sub(r'[A-Za-z]:/[^\"]*?/tmp\.[A-Za-z0-9]+','<throwaway-tmp-registry>',p.read_text(encoding='utf-8')).encode())" $OUT
grep -cE 'Users/|AppData|/tmp' $OUT   # must print 0
```
`approval.kind` is `simulated` when the `--by` text marks an agent or test (`not a human`, `(agent`, `recorded-sim`). Otherwise it is `host_cli`, meaning typed on the host CLI; the name is not identity-verified. The UI counts only `host_cli` as a person's decision.

## Tests (supported invocation)
```bash
python -m pytest -q -p no:cacheprovider experiments/oncall_infer/test_oncall_infer.py
```
Run that file, not the directory. `reference_skill/tests/test_helper.py` does `from helper import run`, as every skill in this repo does. It runs only inside the skill sandbox, where `scripts/` is on the path, and through `test_reference_skill_passes_hidden_and_stops_pending`. Collecting the directory gives `ModuleNotFoundError: No module named 'helper'`. That is expected, not a hidden failure. `scripts/unified.py test full` collects only `experiments/*/test_*.py`.

## Reuse gate and the known core gap
- Reuse here requires two things: core `match_skills` must say `exact`, and the incident fingerprint must equal the one stored in the approved skill's registry row (`skills.validation.incident_fingerprint`). A missing fingerprint refuses (fail closed).
- **Known gap (core, frozen):** core `match_skills` reports INC-3 as `exact`. Core paths that reuse skills (`app/ops.py`, `app/skillforge.py` `solve`, `app/bench.py`, `experiments/router`) do not consult the incident fingerprint.
- What contains the gap today:
  1. The OnCall skill lives in its own registry (`data/unified/demo/oncall/`), which the console's core paths do not open.
  2. Approval re-runs the hidden suite, and the suite includes lookalike cases (`disk_full_lookalike_not_applicable`, `key_changed_but_no_oom_not_applicable`). Any approvable skill must propose nothing on a lookalike, so a direct core `run_skill` on INC-3 yields no proposal (`test_core_path_bypass_yields_no_proposal`).
- Closing the gap fully needs a core change, `match_skills` honouring a recorded incident fingerprint. That is out of scope without approval.

## Known simplifications
- The candidate is staged with a direct `skills` row, not `propose_skill`. Core's `propose_skill` needs an executed and verified action to replay, and OnCall never applies one. The INC-1 replay is a regression test instead.
- `service_version` is left out of the fingerprint, because it differs between compatible incidents.
- No GPU telemetry.
