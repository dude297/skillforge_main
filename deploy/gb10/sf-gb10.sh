#!/usr/bin/env bash
# SkillForge on the GB10: ONE entry point over existing commands. Run from the extracted bundle on the GB10.
#   bash deploy/gb10/sf-gb10.sh preflight      read-only: bundle integrity, host, endpoint /health, /v1/models, ONE chat
#   bash deploy/gb10/sf-gb10.sh oncall         live OnCall synthesis (fails loudly, never falls back), stops for a person
#   bash deploy/gb10/sf-gb10.sh reuse          after a PERSON typed the approve command: INC-2 reuse + INC-3 refusal
#   bash deploy/gb10/sf-gb10.sh bench [label]  experiments/gb10_bench/frontier.sh on the served model
#   bash deploy/gb10/sf-gb10.sh demo           console + guided demo on 127.0.0.1 (start-demo.sh --no-open)
# Env (no secrets in this file): LLM_BASE_URL (default http://127.0.0.1:8000/v1), MODEL (default auto = served id),
# VLLM_KEY_FILE (default ~/.nemoclaw/dual-station-vllm-api-key; read into LLM_API_KEY, never printed).
# Never: approves, onboards, switches models, pulls images, downloads, deletes outside this directory.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
PY=${PY:-python3}
export LLM_BASE_URL=${LLM_BASE_URL:-http://127.0.0.1:8000/v1}
MODEL=${MODEL:-auto}
export LLM_TIMEOUT=${LLM_TIMEOUT:-120}   # check-llm request timeout: a cold first request to a reasoning model can exceed 30 s
KEYFILE=${VLLM_KEY_FILE:-$HOME/.nemoclaw/dual-station-vllm-api-key}
if [ -z "${LLM_API_KEY:-}" ] && [ -r "$KEYFILE" ]; then export LLM_API_KEY=$(cat "$KEYFILE"); KEYSRC="key file"; else KEYSRC=${LLM_API_KEY:+env}; fi
CMD=${1:-help}; shift || true
EV=results/gb10-evidence/$(date -u +%Y%m%dT%H%M%SZ)-$CMD; mkdir -p "$EV"
exec > >(tee -a "$EV/console.txt") 2>&1   # every command leaves its own evidence folder
echo "== $CMD  $(date -u +%FT%TZ)  host=$(hostname)  arch=$(uname -m)  bundle=$(cat COMMIT 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "   endpoint=$LLM_BASE_URL  model=$MODEL  api key: ${KEYSRC:-none}"
FAIL=0
chk() { if eval "$2" >>"$EV/checks.log" 2>&1; then echo "  PASS  $1"; else echo "  FAIL  $1   -> $3"; FAIL=1; fi; }
inf() { printf '  INFO  %-28s %s\n' "$1" "$(eval "$2" 2>/dev/null | head -${3:-1} | tr '\n' ' ')"; }

case "$CMD" in
preflight)
  echo "-- bundle"
  if [ -f SHA256SUMS ]; then
  chk "bundle checksums"        'sha256sum --quiet -c SHA256SUMS'                       "bundle corrupted in transfer: copy it again"
  else  # git checkout instead of a bundle: tracked files must match HEAD
  chk "git checkout clean"      'git diff --quiet HEAD --'                              "uncommitted changes to tracked files: commit or stash them"
  inf "git HEAD"                'git log -1 --format="%h %s"'
  fi
  chk "python3 >= 3.11"         "$PY -c 'import sys; sys.exit(sys.version_info < (3,11))'" "use the system python3"
  inf "pytest (only for tests)" "$PY -c 'import pytest; print(pytest.__version__)' || echo 'absent: test suites unavailable; demo unaffected'"
  echo "-- host (read-only)"
  inf "gpu"                     'nvidia-smi --query-gpu=name,driver_version,temperature.gpu,memory.used --format=csv,noheader'
  inf "MemAvailable"            "awk '/MemAvailable/ {printf \"%.1f GiB\", \$2/1048576}' /proc/meminfo"
  inf "disk free here"          "df -h --output=avail . | tail -1"
  inf "docker containers"       "docker ps --format '{{.Names}} {{.Image}} {{.Status}}'" 5
  inf "managed vLLM container"  "docker ps --filter label=com.nvidia.nemoclaw.managed-vllm=true --format '{{.Names}} {{.Image}} {{.Status}}'"
  chk "port 8766 free (console)" "! (exec 3<>/dev/tcp/127.0.0.1/8766) 2>/dev/null"        "a console already runs: the launcher will attach to it"
  echo "-- inference (a running container is NOT live inference: these three must pass)"
  chk "GET ${LLM_BASE_URL%/v1}/health" "curl -sf --max-time 5 ${LLM_BASE_URL%/v1}/health" "vLLM not up: docker logs <vllm container> | tail -50 (runbook R1b)"
  curl -sf --max-time 5 ${LLM_API_KEY:+-H "Authorization: Bearer $LLM_API_KEY"} "$LLM_BASE_URL/models" > "$EV/models.json" 2>>"$EV/checks.log"
  chk "GET /v1/models lists a model" "$PY -c 'import json,sys; d=json.load(open(sys.argv[1]))[\"data\"]; sys.exit(not d)' $EV/models.json" "endpoint up but serves nothing, or 401 (key)"
  inf "served model ids"        "$PY -c 'import json,sys; print(\" \".join(m[\"id\"] for m in json.load(open(sys.argv[1]))[\"data\"]))' $EV/models.json"
  [ "$MODEL" != auto ] && export LLM_MODEL=$MODEL
  $PY -m app check-llm > "$EV/check-llm.json" 2>&1; rc=$?
  chk "one real chat completion (check-llm)" "[ $rc = 0 ] && grep -q '\"mock\": false' $EV/check-llm.json" "see $EV/check-llm.json"
  inf "check-llm"               "grep -E '\"model\"|elapsed_s|structured_output_ok' $EV/check-llm.json" 4
  echo; [ $FAIL = 0 ] && echo "PREFLIGHT: PASS -> LIVE INFERENCE VERIFIED on this host. Next: bash deploy/gb10/sf-gb10.sh oncall" \
                     || echo "PREFLIGHT: FAIL -> live inference NOT verified. Recorded demo still works: bash deploy/gb10/sf-gb10.sh demo"
  exit $FAIL ;;
oncall)
  $PY -m experiments.oncall_infer run --live --base-url "$LLM_BASE_URL" --model "$MODEL"; rc=$?
  cp data/unified/demo/oncall-run.json "$EV/" 2>/dev/null
  [ $rc = 0 ] && echo "STOP. A PERSON reads $EV/oncall-run.json (code + hidden tests), types the approve command above, then: bash deploy/gb10/sf-gb10.sh reuse"
  exit $rc ;;
reuse)
  $PY -m experiments.oncall_infer reuse; rc=$?
  cp data/unified/demo/oncall-run.json "$EV/" 2>/dev/null; exit $rc ;;
bench)
  bash experiments/gb10_bench/frontier.sh "${1:-gb10-live}" --concurrency 1,2,4 ;;
demo)
  bash start-demo.sh --no-open "$@" ;;
*)
  sed -n '2,10p' "$0"; exit 1 ;;
esac
