"""python -m experiments.oncall_infer run [--live --base-url URL --model ID|auto] [--allow-fallback] [--state DIR] [--out PATH] | reuse
--live fails loudly (exit 2, no run or registry written; the audit goes to <out>.failed.json) when the endpoint, the model id or the synthesis fails. Only
--allow-fallback turns that into a labelled RECORDED_SIMULATION. --model auto = the id the server lists in /v1/models
(the served name, which can differ from the Hugging Face repo name)."""
import argparse
import json
import sys

from adapters import llm as llm_mod
from experiments.oncall_infer import oncall

p = argparse.ArgumentParser(prog="python -m experiments.oncall_infer")
p.add_argument("cmd", choices=["run", "reuse"])
p.add_argument("--live", action="store_true", help="synthesize with the real served model")
p.add_argument("--base-url", default="http://127.0.0.1:8000/v1")
p.add_argument("--model", default="auto", help="served model id, or 'auto' (first id from /v1/models)")
p.add_argument("--allow-fallback", action="store_true", help="on model failure write a labelled RECORDED_SIMULATION")
p.add_argument("--state", default=str(oncall.DEFAULT_STATE), help="isolated registry dir (DB + skills)")
p.add_argument("--out", default=str(oncall.DEFAULT_OUT))
a = p.parse_args()
if a.cmd == "run":
    model = None if a.model == "auto" else a.model
    try:
        d = oncall.run(a.live, a.base_url if a.live else None, model if a.live else None, a.state, a.out,
                       allow_fallback=a.allow_fallback or not a.live)
    except llm_mod.LLMUnavailable as e:
        print(f"LIVE RUN FAILED (no run or registry written, no fallback); failure log: {getattr(e, 'failure_log', 'none, failed before the run started')}\n  {e}", file=sys.stderr)
        print("  check: curl -s <base-url>/models ; python -m app check-llm ; or pass --model <served id>", file=sys.stderr)
        sys.exit(2)
    print(f"mode: {d['mode']}   provenance: {d['synthesis']['provenance']}   model: {d['model']['id']}   "
          f"model_calls: {d['synthesis']['model_calls']}   latency_ms: {d['synthesis']['latency_ms']}")
    print(f"verification passed: {d['verification']['passed']}  "
          f"hidden {sum(x['pass'] for x in d['verification']['hidden'])}/{len(d['verification']['hidden'])}")
    print(f"approval: {d['approval']['state']}\n  a PERSON runs (bash, repo root):\n  {d['approval']['command']}")
    print("  then: python -m experiments.oncall_infer reuse" + (f" --state {a.state} --out {a.out}" if a.out != str(oncall.DEFAULT_OUT) else ""))
else:
    d = oncall.reuse(a.state, a.out)
    print(json.dumps({k: d[k] for k in ("approval", "reuse", "refusal")}, indent=1))
print(f"wrote {a.out}")
