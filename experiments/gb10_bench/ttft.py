"""EXPERIMENT (research/gb10-bench): client-side TTFT / end-to-end / tokens-per-second probe against an
OpenAI-compatible STREAMING /v1/chat/completions endpoint. Stdlib only. Never imported by the core.

Running it against a real model is a GPU workload: AUTHORIZATION REQUIRED at the event (docs/GB10_BENCH_RUNBOOK.md).
Unknown values stay None, never 0. Fake-server results are plumbing checks, not measurements.

  python -m experiments.gb10_bench.ttft --base-url http://127.0.0.1:8000/v1 [--model ID] [--n 10] [--warmup 2]
         [--max-tokens 128] [--out results/gb10_bench/ttft.json]      # LLM_API_KEY from env (bearer)
         # optional env LLM_CHAT_TEMPLATE_KWARGS (JSON) is sent as chat_template_kwargs (e.g. disable thinking)
"""
import argparse
import json
import os
import platform
import statistics
import time
import urllib.request

PROMPT = "Count from 1 to 40, separated by spaces. Output only the numbers."


def probe(base_url, model, prompt=PROMPT, max_tokens=128, api_key=None, timeout=120):
    """One streamed request. first_token_s = first chunk carrying content OR reasoning (reasoning models think first)."""
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens,
            "temperature": 0, "stream": True, "stream_options": {"include_usage": True}}
    # opt-in, same env as adapters/llm.py: e.g. LLM_CHAT_TEMPLATE_KWARGS='{"enable_thinking": false}' for Qwen3.x thinking-by-default
    if os.environ.get("LLM_CHAT_TEMPLATE_KWARGS"):
        body["chat_template_kwargs"] = json.loads(os.environ["LLM_CHAT_TEMPLATE_KWARGS"])
    req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {api_key}"} if api_key else {})})
    out = {"first_byte_s": None, "first_token_s": None, "e2e_s": None, "completion_tokens": None,
           "prompt_tokens": None, "decode_tok_s": None, "chunks": 0, "error": None}
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            for raw in r:  # SSE: "data: {...}\n" lines, blank separators, "data: [DONE]"
                if out["first_byte_s"] is None:
                    out["first_byte_s"] = time.perf_counter() - t0
                line = raw.decode().strip()
                if not line.startswith("data:") or line == "data: [DONE]":
                    continue
                chunk = json.loads(line[5:])
                out["chunks"] += 1
                delta = (chunk.get("choices") or [{}])[0].get("delta") or {}
                if out["first_token_s"] is None and any(delta.get(k) for k in ("content", "reasoning_content", "reasoning")):
                    out["first_token_s"] = time.perf_counter() - t0
                if chunk.get("usage"):
                    out["completion_tokens"] = chunk["usage"].get("completion_tokens")
                    out["prompt_tokens"] = chunk["usage"].get("prompt_tokens")
        out["e2e_s"] = time.perf_counter() - t0
    except Exception as e:  # a failed probe is recorded, never turned into a number
        out["error"] = f"{type(e).__name__}: {e}"[:300]
        return out
    decode = out["e2e_s"] - out["first_token_s"] if out["first_token_s"] is not None else None
    if out["completion_tokens"] and out["completion_tokens"] > 1 and decode:  # tokens after the first / decode time
        out["decode_tok_s"] = (out["completion_tokens"] - 1) / decode
    return out


def summarise(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    med = statistics.median(xs)
    return {"n": len(xs), "p50": round(med, 4), "p95": round(xs[min(len(xs) - 1, int(0.95 * len(xs)))], 4),
            "mad": round(statistics.median(abs(x - med) for x in xs), 4)}


def run(base_url, model=None, n=10, warmup=2, max_tokens=128, api_key=None, label=None):
    if not model:
        req = urllib.request.Request(base_url.rstrip("/") + "/models",
                                     headers={"Authorization": f"Bearer {api_key}"} if api_key else {})
        with urllib.request.urlopen(req, timeout=10) as r:
            model = json.loads(r.read())["data"][0]["id"]
    for _ in range(warmup):  # discarded: first requests pay compile/cache warm-up
        probe(base_url, model, max_tokens=max_tokens, api_key=api_key)
    trials = [probe(base_url, model, max_tokens=max_tokens, api_key=api_key) for _ in range(n)]
    ok = [t for t in trials if not t["error"]]
    return {"label": label, "host": platform.node(), "machine": platform.machine(), "base_url": base_url,
            "model": model, "max_tokens": max_tokens, "warmup_discarded": warmup, "n": n, "errors": len(trials) - len(ok),
            "summary": {k: summarise([t[k] for t in ok]) for k in ("first_byte_s", "first_token_s", "e2e_s", "decode_tok_s")},
            "trials": trials}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8000/v1"))
    ap.add_argument("--model")
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--max-tokens", type=int, default=128)
    ap.add_argument("--label", required=True, help="e.g. 'GB10 qwen36 authorized by <name>' or 'FAKE SERVER'")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    res = run(a.base_url, a.model, a.n, a.warmup, a.max_tokens, os.environ.get("LLM_API_KEY"), a.label)
    text = json.dumps(res, indent=2)
    if a.out:
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        with open(a.out, "w", newline="") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
