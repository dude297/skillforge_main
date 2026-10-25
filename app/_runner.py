"""Child-process entry for UNTRUSTED skill code. Launched only by app/skillforge.py via `python -I`.

  python -I _runner.py run     <skill_dir>   stdin: JSON input -> stdout: JSON from helper.run(input)
  python -I _runner.py test    <skill_dir>   runs every test_* function in tests/test_helper.py
  python -I _runner.py profile <skill_dir>   one timed run + one traced run (line events, internal calls,
                                             repeated identical calls, peak memory, bytes in/out)
  python -I _runner.py bench   <skill_dir>   stdin: {"input": ..., "repeats": n} -> per-call times (ms)

ponytail: the guards here are speed bumps (they stop accidents, not attackers). The real boundaries are the
parent's scrubbed env/rlimits/timeout and the OpenShell sandbox around the whole agent.
"""
import io
import json
import runpy
import socket
import subprocess
import sys
import time
import tracemalloc
import traceback
from pathlib import Path


def _blocked(*_, **__):
    raise PermissionError("blocked in skill runner")


socket.socket = socket.create_connection = _blocked  # no network
subprocess.Popen = _blocked                            # no child processes
import os  # noqa: E402
os.system = os.popen = _blocked
for _name in ("remove", "unlink", "rmdir", "rename", "replace", "chmod"):
    setattr(os, _name, _blocked)


def _profile(helper, raw):
    t0 = time.perf_counter()
    out = helper.run(json.loads(raw))
    elapsed = (time.perf_counter() - t0) * 1000
    hf, lines, calls, seen = helper.__file__, [0], {}, {}

    def local(frame, event, arg):
        if event == "line":
            lines[0] += 1
        return local

    def on_call(frame, event, arg):  # only helper code is traced; stdlib/builtins are not
        if frame.f_code.co_filename != hf:
            return None
        name = frame.f_code.co_name
        calls[name] = calls.get(name, 0) + 1
        if name != "run" and not name.startswith("<"):
            key = (name, f"{sorted(frame.f_locals.items())!r}"[:2000])
            seen[key] = seen.get(key, 0) + 1
        return local

    data = json.loads(raw)
    tracemalloc.start()
    sys.settrace(on_call)
    try:
        helper.run(data)
    finally:
        sys.settrace(None)
        peak = tracemalloc.get_traced_memory()[1]
        tracemalloc.stop()
    dups = {}  # function name -> repeated calls with identical arguments (values never reported: no data leak)
    for (fn, _), n in seen.items():
        if n > 1:
            dups[fn] = dups.get(fn, 0) + n - 1
    return out, {"elapsed_ms": round(elapsed, 4), "line_events": lines[0], "function_calls": calls,
                 "duplicate_calls": sum(dups.values()), "duplicates_by_function": dups,
                 "peak_kb": peak // 1024, "input_bytes": len(raw),
                 "output_bytes": len(json.dumps(out, default=str))}


def main():
    mode, skill_dir = sys.argv[1], Path(sys.argv[2])
    sys.path.insert(0, str(skill_dir / "scripts"))
    raw = sys.stdin.read()
    real_stdout, sys.stdout = sys.stdout, io.StringIO()  # helper prints must not corrupt our JSON
    try:
        if mode == "test":
            ns = runpy.run_path(str(skill_dir / "tests" / "test_helper.py"), run_name="skill_tests")
            tests = sorted(k for k, v in ns.items() if k.startswith("test_") and callable(v))
            failures = []
            for t in tests:
                try:
                    ns[t]()
                except Exception:
                    failures.append({"test": t, "error": traceback.format_exc(limit=3)[-600:]})
            result = {"ok": bool(tests) and not failures, "tests_run": len(tests), "failures": failures}
        else:
            import helper
            if mode == "run":
                result = {"ok": True, "output": helper.run(json.loads(raw))}
            elif mode == "profile":
                out, prof = _profile(helper, raw)
                result = {"ok": True, "output": out, "profile": prof}
            elif mode == "bench":
                req = json.loads(raw)
                payload, times = json.dumps(req["input"]), []
                for _ in range(int(req["repeats"])):
                    data = json.loads(payload)  # fresh copy each call; parse time excluded
                    t0 = time.perf_counter()
                    helper.run(data)
                    times.append((time.perf_counter() - t0) * 1000)
                result = {"ok": True, "times_ms": times}
            else:
                result = {"ok": False, "error": f"unknown mode {mode}"}
    except Exception:
        result = {"ok": False, "error": traceback.format_exc(limit=3)[-800:]}
    sys.stdout = real_stdout
    print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
