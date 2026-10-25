#!/usr/bin/env bash
# HOST-side operator wrapper for the app installed in the NemoClaw sandbox (human commands only).
#   SKILL_DIR=<installed skill dir> bash scripts/ro.sh task begin "A-real" --mode real
#   bash scripts/ro.sh approve 1 2 --by alice
#   bash scripts/ro.sh skill approve <name> <ver> --by alice
#   bash scripts/ro.sh task end            # model calls = vLLM request counter delta measured HERE on the host
# UNVERIFIED on GB10: `nemoclaw <sb> exec -- ...` syntax is from the NemoClaw docs.
set -euo pipefail
SANDBOX=${SANDBOX:-my-assistant}
SKILL_DIR=${SKILL_DIR:?set SKILL_DIR to the installed records-ops dir inside the sandbox}
METRICS=${LLM_METRICS_URL:-http://127.0.0.1:8000/metrics}
STATE="$(dirname "$0")/../data/.task_counter"

counter() {  # prints the summed counter, or nothing if unreachable (never a fake 0)
  curl -sf --max-time 3 "$METRICS" | awk '/^vllm:request_success_total/ {s+=$NF; n++} END {if (n) printf "%d\n", s}'
}

args=("$@")
sb() { nemoclaw "$SANDBOX" exec -- sh -c "$1"; }

if [ "${1:-} ${2:-}" = "skill approve" ]; then
  # Host-side gate before promotion (the agent can't see or edit any of this):
  # 1) the app code in the sandbox must still be byte-identical to the package we installed
  #    (sha256sum is /usr/bin, read-only in the sandbox, so the agent can't fake it by editing our Python)
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  [ -d "$ROOT/dist/records-ops" ] || { echo "run scripts/package_skill.sh first (reference copy)"; exit 1; }
  want=$(cd "$ROOT/dist/records-ops" && sha256sum app/*.py)
  got=$(sb "cd '$SKILL_DIR' && sha256sum app/*.py")
  [ "$want" = "$got" ] || { echo "REFUSING: sandbox app code differs from the installed package"; diff <(echo "$want") <(echo "$got"); exit 1; }
  # 2) run the HIDDEN validation suite (validation/, never shipped) on the host against the exact candidate files
  tmp=$(mktemp -d)
  nemoclaw "$SANDBOX" download "/sandbox/skillforge/candidates/$3/v$4" "$tmp"   # UNVERIFIED: download layout
  cand=$(dirname "$(find "$tmp" -name meta.json | head -1)")
  res=$(cd "$ROOT" && python3 -m app skill hidden-check "$cand") || true
  echo "$res"
  sha=$(printf '%s' "$res" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r["sha256"] if r.get("ok") else "")')
  rm -rf "$tmp"
  [ -n "$sha" ] || { echo "REFUSING: hidden validation failed"; exit 1; }
  args+=(--hidden-sha "$sha")
elif [ "${1:-} ${2:-}" = "task begin" ]; then
  counter > "$STATE" || true
elif [ "${1:-} ${2:-}" = "task mark" ] && [ -s "$STATE" ]; then   # e.g. task mark solved / skill_generated
  now=$(counter || true)
  [ -n "$now" ] && args+=(--model-calls "$(( now - $(cat "$STATE") ))")
elif [ "${1:-} ${2:-}" = "task end" ] && [ -s "$STATE" ]; then
  now=$(counter || true)
  [ -n "$now" ] && args+=(--model-calls "$(( now - $(cat "$STATE") ))")
  rm -f "$STATE"
fi
quoted=$(printf ' %q' "${args[@]}")
exec nemoclaw "$SANDBOX" exec -- sh -c \
  "cd '$SKILL_DIR' && APP_DB=/sandbox/records-ops.db SKILLS_DIR=/sandbox/skillforge python3 -m app$quoted"
