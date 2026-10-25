"""EXPERIMENT: model power-state CAPABILITY DETECTION. Read-only: it never sleeps, wakes, stops or restarts anything.

vLLM exposes /is_sleeping, /sleep, /wake_up only when started with --enable-sleep-mode and VLLM_SERVER_DEV_MODE=1
(per vLLM docs; NOT verified on the GB10 / NemoClaw-managed vLLM). We only GET /is_sleeping. Unknown stays None.

  python -m experiments.router.power
"""
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request


def _root(base_url):
    return base_url.rstrip("/").removesuffix("/v1")


def detect(base_url=None, timeout=3):
    base_url = base_url or os.environ.get("LLM_BASE_URL", "mock")
    out = {"ts": time.time(), "endpoint": None, "sleep_mode": None, "is_sleeping": None, "detail": None,
           "gpu_power_w": gpu_power_w()}
    if base_url == "mock":
        out["detail"] = "unknown: LLM_BASE_URL not set"
        return out
    out["endpoint"] = _root(base_url)
    key = os.environ.get("LLM_API_KEY")
    req = urllib.request.Request(out["endpoint"] + "/is_sleeping", headers={"Authorization": f"Bearer {key}"} if key else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read() or b"{}")
        out["sleep_mode"], out["is_sleeping"] = True, body.get("is_sleeping")
        out["detail"] = "endpoint present (detected, sleep/wake NOT exercised)"
    except urllib.error.HTTPError as e:
        out["sleep_mode"] = False if e.code == 404 else None
        out["detail"] = f"HTTP {e.code}" + (" : not exposed (needs --enable-sleep-mode + VLLM_SERVER_DEV_MODE=1)"
                                            if e.code == 404 else "")
    except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
        out["detail"] = f"unreachable: {e}"
    return out


def gpu_power_w():
    """nvidia-smi power.draw summed; None when absent or '[N/A]' (possible on GB10 unified memory: unverified)."""
    if not shutil.which("nvidia-smi"):
        return None
    try:
        lines = subprocess.run(["nvidia-smi", "--query-gpu=power.draw", "--format=csv,noheader,nounits"],
                               capture_output=True, text=True, timeout=5).stdout.split()
        return sum(float(x) for x in lines) if lines else None
    except (ValueError, subprocess.SubprocessError, OSError):
        return None


def recommend(idle_s, caps, idle_policy_s=None):
    """Advice only. With no validated policy (default) the answer is always 'none'."""
    if idle_policy_s is None:
        return {"action": "none", "reason": "no idle policy configured (enable only after GB10 validation)"}
    if caps.get("sleep_mode") is not True:
        return {"action": "none", "reason": f"sleep mode not detected ({caps.get('detail')})"}
    if idle_s < idle_policy_s:
        return {"action": "none", "reason": f"idle {idle_s:.0f}s < policy {idle_policy_s}s"}
    return {"action": "operator_may_sleep", "reason": f"idle {idle_s:.0f}s >= {idle_policy_s}s; operator decides"}


if __name__ == "__main__":
    print(json.dumps(detect(), indent=2))
