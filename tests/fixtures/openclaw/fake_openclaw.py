"""Stand-in for `openclaw agent --session-id S -m M --json`: logs (session, message) to $FAKE_LOG and prints
a fixture. FAKE_MODE=ok|banner|missing|inflight|flat|garbage|fail|flaky|hang. Test double only; proves nothing about real OpenClaw."""
import json
import os
import sys
from pathlib import Path

session, message = sys.argv[1], sys.argv[2]
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps([session, message]) + "\n")
ok = (Path(__file__).parent / "agent_ok.json").read_text()
mode = os.environ.get("FAKE_MODE", "ok")
if mode == "hang":
    import time
    time.sleep(30)
if mode == "flaky":  # first call fails like a down gateway, later calls succeed
    marker = Path(os.environ["FAKE_LOG"] + ".flaky")
    if not marker.exists():
        marker.write_text("1")
        print("gateway connect ECONNREFUSED", file=sys.stderr)
        sys.exit(1)
    mode = "ok"
if mode == "fail":
    print("gateway not running", file=sys.stderr)
    sys.exit(1)
print({"ok": ok, "banner": "[nemoclaw] exec in sandbox my-assistant\n" + ok,
       "missing": json.dumps({"status": "ok", "result": {"payloads": [], "meta": {"durationMs": 5}}}),
       "inflight": json.dumps({"status": "in_flight", "result": {}}),
       "flat": json.dumps({"ok": True, "final": "x", "assistantTurns": 2, "toolSummary": {"calls": 1}}),  # agent exec
       "garbage": "Error: unknown option --json"}[mode])
