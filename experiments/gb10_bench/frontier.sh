#!/usr/bin/env bash
# EXPERIMENT: GB10 compute-frontier measurement for the SERVED model. Run ON the GB10, repo root.
#   bash experiments/gb10_bench/frontier.sh <label> [--concurrency 1,2,4]     # identity, sampling, probe, ttft, oncall run
#   bash experiments/gb10_bench/frontier.sh <label> --after-approval          # oncall reuse, after a PERSON approved
#   python3 -m experiments.gb10_bench.frontier_report report                  # merge results/frontier/*/
# GPU inference: AUTHORIZATION REQUIRED (docs/GB10_BENCH_RUNBOOK.md). Put the authorizer's name in your notes/label.
# Never switches models, onboards, downloads, or changes serve flags. Reads docker/nvidia-smi/nemoclaw only.
# Env: LLM_BASE_URL (http://127.0.0.1:8000/v1), LLM_API_KEY (else ~/.nemoclaw/dual-station-vllm-api-key),
#      LLM_CHAT_TEMPLATE_KWARGS (JSON, optional; inherited by ttft.py/oncall_infer, e.g. '{"enable_thinking": false}'),
#      FRONTIER_MIN_MEM_GIB (16), FRONTIER_MAX_TEMP_C (85), FRONTIER_STAGE_TIMEOUT_S (600), FRONTIER_ONCALL_TIMEOUT_S (1200),
#      FRONTIER_ROOT (results/frontier), PYTHON (python3), FRONTIER_STAGES (probe,ttft,oncall),
#      FRONTIER_ALLOW_UNKNOWN_SENSORS=1 runs without a readable temp/MemAvailable (recorded in stages.tsv; stub tests only).
set -u
cd "$(dirname "$0")/../.."
LABEL=${1:?label, e.g. gb10-qwen36-35b}; shift
[[ $LABEL =~ ^[A-Za-z0-9._-]+$ ]] || { echo "label: letters, digits, . _ - only"; exit 2; }
CONC=1; AFTER=0
while [ $# -gt 0 ]; do
  case $1 in
    --concurrency) CONC=${2:?}; shift 2 ;;
    --after-approval) AFTER=1; shift ;;
    *) echo "unknown arg $1"; exit 2 ;;
  esac
done
for c in ${CONC//,/ }; do [[ $c =~ ^[1-4]$ ]] || { echo "concurrency must be 1..4 (got $c)"; exit 2; }; done
PY=${PYTHON:-python3}
export LLM_BASE_URL=${LLM_BASE_URL:-http://127.0.0.1:8000/v1}
KEYFILE=${VLLM_KEY_FILE:-$HOME/.nemoclaw/dual-station-vllm-api-key}
[ -z "${LLM_API_KEY:-}" ] && [ -r "$KEYFILE" ] && export LLM_API_KEY=$(cat "$KEYFILE")
MIN_MEM_KIB=$(( ${FRONTIER_MIN_MEM_GIB:-16} * 1048576 )); MAX_TEMP=${FRONTIER_MAX_TEMP_C:-85}
TMO=${FRONTIER_STAGE_TIMEOUT_S:-600}; STAGES=${FRONTIER_STAGES:-probe,ttft,oncall}
OUT=${FRONTIER_ROOT:-results/frontier}/$LABEL; mkdir -p "$OUT"
STATE=$OUT/oncall-state; RUN=$OUT/oncall-run.json
mark() { printf '%s\t%s\t%s\n' "$1" "$2" "$(date -u +%FT%TZ)" >> "$OUT/stages.tsv"; echo "[$1] $2"; }

if [ $AFTER = 1 ]; then  # reuse only: deterministic fast path, NoModel guard counts any model call
  [ -f "$RUN" ] || { echo "no $RUN: run without --after-approval first"; exit 2; }
  $PY -m experiments.oncall_infer reuse --state "$STATE" --out "$RUN" && mark reuse ok || mark reuse failed
  exit 0
fi

gpu_temp() { nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -cd '0-9'; }
mem_avail() { awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null; }
guard() {  # 0 = safe to load; unknown sensors abort unless explicitly overridden
  local t m; t=$(gpu_temp); m=$(mem_avail)
  if [ -z "$t" ] || [ -z "$m" ]; then
    [ "${FRONTIER_ALLOW_UNKNOWN_SENSORS:-0}" = 1 ] && { mark "guard:$1" "override_unknown_sensors temp=${t:-null} memavail_kib=${m:-null}"; return 0; }
    mark "guard:$1" "abort_unknown_sensors temp=${t:-null} memavail_kib=${m:-null}"; return 1
  fi
  [ "$m" -lt "$MIN_MEM_KIB" ] && { mark "guard:$1" "abort_mem memavail_kib=$m"; return 1; }
  [ "$t" -gt "$MAX_TEMP" ] && { mark "guard:$1" "abort_temp temp=$t"; return 1; }
  return 0
}
watch() {  # watch <stage> <timeout_s> <pid...>: kill all on timeout or temp breach
  local name=$1 lim=$2 t0=$SECONDS t; shift 2
  while :; do
    local alive=0; for p in "$@"; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ $alive = 0 ] && break
    t=$(gpu_temp)
    if [ -n "$t" ] && [ "$t" -gt "$MAX_TEMP" ]; then kill "$@" 2>/dev/null; mark "$name" "aborted_temp temp=$t"; return 1; fi
    if [ $((SECONDS - t0)) -gt "$lim" ]; then kill "$@" 2>/dev/null; mark "$name" "aborted_timeout ${lim}s"; return 1; fi
    sleep 2
  done
  local rc=0; for p in "$@"; do wait "$p" || rc=1; done
  mark "$name" "$([ $rc = 0 ] && echo ok || echo failed)"; return $rc
}

# 2. background sampler, 1 s; [N/A] / Not Supported recorded as empty (= null)
echo "ts,temp_c,power_w,util_pct,mem_used_mib,mem_available_kib" > "$OUT/samples.csv"
( while :; do
    q=$(nvidia-smi --query-gpu=temperature.gpu,power.draw,utilization.gpu,memory.used --format=csv,noheader,nounits 2>/dev/null | head -1)
    q=$(printf '%s' "${q:-,,,}" | sed 's/\[N\/A\]//g; s/Not Supported//g; s/ //g')
    echo "$(date +%s),$q,$(mem_avail)" >> "$OUT/samples.csv"; sleep 1
  done ) & SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null' EXIT INT TERM

# 1. identity (read only)
$PY -m experiments.gb10_bench.frontier_report identity --base-url "$LLM_BASE_URL" --out "$OUT/identity.json" >/dev/null \
  && mark identity ok || mark identity failed
guard start || { echo "ABORT before any load: see $OUT/stages.tsv"; exit 3; }

# 4a. tool-call capability probe (core models.probe; does not overwrite data/model_probe.json)
if [[ ,$STAGES, == *,probe,* ]]; then
  guard probe && { $PY -m experiments.gb10_bench.frontier_report probe --out "$OUT/probe.json" >/dev/null & watch probe "$TMO" $!; }
fi
# 4b. TTFT/decode at each concurrency: N parallel ttft.py copies, n=10 warm-up 2, max_tokens 128, distinct --out
if [[ ,$STAGES, == *,ttft,* ]]; then
  for c in ${CONC//,/ }; do
    guard "ttft-c$c" || break
    pids=(); for i in $(seq 1 "$c"); do
      $PY -m experiments.gb10_bench.ttft --base-url "$LLM_BASE_URL" --n 10 --warmup 2 --max-tokens 128 \
        --label "frontier $LABEL c=$c copy=$i" --out "$OUT/ttft-c$c-$i.json" >/dev/null & pids+=($!)
    done
    watch "ttft-c$c" "$TMO" "${pids[@]}" || break
  done
fi
# 4c. OnCall live run into its OWN registry (never the demo registry), then STOP for a person
if [[ ,$STAGES, == *,oncall,* ]]; then
  MODEL=$($PY -c 'import json,sys;print((json.load(open(sys.argv[1]))["server"]["model_id"]) or "")' "$OUT/identity.json" 2>/dev/null)
  if [ -z "$MODEL" ]; then mark oncall "skipped_no_model_id"
  elif guard oncall; then
    $PY -m experiments.oncall_infer run --live --base-url "$LLM_BASE_URL" --model "$MODEL" --state "$STATE" --out "$RUN" \
      > "$OUT/oncall-stdout.txt" 2>&1 & watch oncall "${FRONTIER_ONCALL_TIMEOUT_S:-1200}" $!
    cat "$OUT/oncall-stdout.txt"
    echo; echo "STOP. A PERSON reviews $RUN, runs the approve command printed above (if staged), then:"
    echo "  bash experiments/gb10_bench/frontier.sh $LABEL --after-approval"
  fi
fi
echo "results: $OUT   (merge: $PY -m experiments.gb10_bench.frontier_report report)"
