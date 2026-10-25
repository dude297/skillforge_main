#!/usr/bin/env bash
# Operator-controlled LOCAL model switch with verification and rollback. Never a cloud fallback.
#   bash scripts/switch_model.sh <new-profile-id> <previous-profile-id>
# Mechanism (NemoClaw LKG v0.0.135, docs/research/): onboard never stops a running vLLM, so the managed
# container is stopped first; `onboard --profile` then serves the new model and recreates the sandbox
# (home/workspace are copied, so installed skills carry over: re-check policies anyway).
# Only ONE model is resident: there is no hot standby. Expect several minutes of downtime per switch.
# After switching, the model must pass `python3 -m app models probe` or we switch back.
set -u
cd "$(dirname "$0")/.."
NEW=${1:?new profile id (nemoclaw profiles list)}; PREV=${2:?previous profile id, used for rollback}
SANDBOX=${SANDBOX:-my-assistant}
LOG=results/switch-$(date +%Y%m%d-%H%M%S).log; mkdir -p results
KEYFILE=${VLLM_KEY_FILE:-$HOME/.nemoclaw/dual-station-vllm-api-key}
export LLM_BASE_URL=${LLM_BASE_URL:-http://127.0.0.1:8000/v1}
say() { echo "$*" | tee -a "$LOG"; }

stop_vllm() {  # only the NemoClaw-managed container, identified by its label
  id=$(docker ps -q --filter label=com.nvidia.nemoclaw.managed-vllm=true)
  [ -n "$id" ] && { say "stopping managed vLLM $id"; docker container stop "$id" >>"$LOG" 2>&1; }
  return 0
}
serve() {  # $1 = profile
  stop_vllm
  say "onboard --profile $1"
  nemoclaw onboard --profile "$1" --non-interactive >>"$LOG" 2>&1 || { say "onboard failed for $1"; return 1; }
  [ -r "$KEYFILE" ] && export LLM_API_KEY=$(cat "$KEYFILE")
  for _ in $(seq 1 ${WAIT_TRIES:-180}); do  # readiness: unauthenticated /health, then the model list
    curl -sf --max-time 5 "${LLM_BASE_URL%/v1}/health" >/dev/null && break; sleep ${WAIT_SLEEP:-10}
  done
  python3 -m app models probe > "results/probe-$1.json" 2>>"$LOG"   # writes data/model_probe.json too
}
route_ok() {  # the sandbox's inference route must point at what vLLM serves
  served=$(python3 -c 'import json;print(json.load(open("data/model_probe.json")).get("model") or "")')
  nemoclaw inference get --json 2>>"$LOG" | tee -a "$LOG" | grep -q "\"$served\""
}

say "== switch $PREV -> $NEW ($(date -Is))"
nemoclaw inference get --json >>"$LOG" 2>&1
if serve "$NEW" && route_ok; then
  say "SWITCHED to $NEW: probe passed, route verified. Re-run: nemoclaw $SANDBOX policy list; gb10_preflight.sh gate2"
  exit 0
fi
say "NEW MODEL FAILED (see results/probe-$NEW.json); rolling back to $PREV"
if serve "$PREV" && route_ok; then
  say "ROLLED BACK to $PREV (probe passed). The failed switch is recorded in $LOG"
  exit 3
fi
say "ROLLBACK FAILED: no validated model. Agentic work unavailable -> use 'python3 -m app fastpath' (no-model mode); runbook R1b"
exit 4
