#!/usr/bin/env bash
# GB10 go/no-go diagnostics by gate. Read-only: installs nothing, changes no host settings.
#   bash scripts/gb10_preflight.sh gate0|gate1|gate2|gate3|gate4|gate5|all
# Logs: data/preflight.log (human) + data/preflight.jsonl (one JSON object per check, machine-readable).
# Env (defaults in brackets): SANDBOX [my-assistant]  PORT [8765]  BRIDGE [auto]  SKILL_DIR [auto]
#   LLM_BASE_URL [http://127.0.0.1:8000/v1]  LLM_METRICS_URL [http://127.0.0.1:8000/metrics]
#   RUNNER_IMAGE [python:3.12-slim]  RESULT [results/gate5/result.json]
cd "$(dirname "$0")/.."
SANDBOX=${SANDBOX:-my-assistant}; PORT=${PORT:-8765}
LLM_BASE_URL=${LLM_BASE_URL:-http://127.0.0.1:8000/v1}; LLM_METRICS_URL=${LLM_METRICS_URL:-http://127.0.0.1:8000/metrics}
AUTH=(); [ -n "$LLM_API_KEY" ] && AUTH=(-H "Authorization: Bearer $LLM_API_KEY")  # NemoClaw vLLM uses bearer auth
RUNNER_IMAGE=${RUNNER_IMAGE:-python:3.12-slim}; RESULT=${RESULT:-results/gate5/result.json}
REMOTE_HOST=host.openshell.internal   # what the sandbox dials; OpenShell maps it to the gateway host
LOG=data/preflight.log; JL=data/preflight.jsonl; GATE=?
mkdir -p data
fails=0
log()  { echo "$*" | tee -a "$LOG"; }
jl()   { printf '{"ts":"%s","gate":"%s","check":"%s","pass":%s}\n' "$(date -Is)" "$GATE" "$(echo "$1" | tr -d '"\\')" "$2" >> "$JL"; }
req()  { if eval "$2" >/dev/null 2>&1; then log "PASS  $1"; jl "$1" true; else log "FAIL  $1   -> fix: $3"; jl "$1" false; fails=$((fails+1)); fi; }
info() { log "INFO  $1: $(eval "$2" 2>&1 | head -${3:-1} | tr '\n' ' ')"; }
sbx()  { nemoclaw "$SANDBOX" exec --no-tty -- "$@"; }
bridge() { [ -n "$BRIDGE" ] && { echo "$BRIDGE"; return; }
  for n in openshell-docker openshell bridge; do
    ip=$(docker network inspect "$n" -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null) && [ -n "$ip" ] && { echo "$ip"; return; }
  done; }

gate0() {  # host + container prerequisites (no model needed)
  GATE=0; log "== GATE 0: host prerequisites ($(date -Is))"
  req "arch aarch64"                         '[ "$(uname -m)" = aarch64 ]'                         "wrong machine?"
  req "nvidia-smi sees the GPU"              'nvidia-smi -L | grep -q GPU'                         "driver/runtime: see GB10_SETUP troubleshooting"
  req "docker >= 28, no sudo"                'docker info >/dev/null && [ "$(docker version -f "{{.Server.Version}}" | cut -d. -f1)" -ge 28 ]' "add user to docker group, re-login"
  req "python3 >= 3.11"                      'python3 -c "import sys; sys.exit(sys.version_info < (3,11))"' "use the system python3 (Ubuntu 24.04 ships 3.12)"
  req "node >= 22.19 (NemoClaw)"             'node -e "const [a,b]=process.versions.node.split(\".\").map(Number);process.exit(a>22||(a==22&&b>=19)?0:1)"' "the NemoClaw installer installs node (nvm 22); offline: DEPLOY_MANIFEST node tarball"
  req ">= 60 GB free in \$HOME"              '[ "$(df -Pk "$HOME" | awk "NR==2{print \$4}")" -ge 62914560 ]' "weights ~22-24 GB + vLLM image ~10-13 GB; free space"
  req "runner image present: $RUNNER_IMAGE"  'docker image inspect "$RUNNER_IMAGE"'                "bash scripts/offline.sh restore <usb-stage-dir>"
  req "runner image is linux/arm64"          '[ "$(docker image inspect -f "{{.Os}}/{{.Architecture}}" "$RUNNER_IMAGE")" = linux/arm64 ]' "load the arm64 tar from the stage dir"
  req "pytest importable"                    'python3 -c "import pytest"'                         "pip install --user --no-index --find-links <stage>/wheels pytest"
  req "app test suite passes (subprocess + rlimits)" 'python3 -m pytest -q -p no:cacheprovider'   "read the failing test; core is frozen, report it"
  req "docker runner isolation + mem limit"  'SKILL_RUNNER=docker python3 -m pytest -q -p no:cacheprovider tests/test_bench.py -k "docker"' "see runbook R3"
  info "OS" 'cat /etc/dgx-release 2>/dev/null | head -3; grep PRETTY_NAME /etc/os-release' 4
  info "RAM" 'free -g | awk "/Mem:/{print \$2\" GB total, \"\$7\" GB avail\"}"'
  info "GPU" 'nvidia-smi --query-gpu=name,driver_version --format=csv,noheader'
  info "docker networks" 'docker network ls --format "{{.Name}}"' 10
}

gate1() {  # local inference
  GATE=1; log "== GATE 1: local inference ($(date -Is))"
  req "nemoclaw installed"                   'command -v nemoclaw'                                  "curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash; source ~/.bashrc"
  req "openshell installed"                  'command -v openshell'                                 "comes with nemoclaw install"
  req "sandbox $SANDBOX healthy"             'nemoclaw "$SANDBOX" status'                            "nemoclaw $SANDBOX recover; then rebuild --yes (runbook R1)"
  req "vLLM serves a model"                  'curl -sf --max-time 5 "${AUTH[@]}" "$LLM_BASE_URL/models" | grep -q "\"id\""'   "401? export LLM_API_KEY (runbook Gate 1). else: docker ps | grep vllm; nemoclaw onboard --resume (R1)"
  req "vLLM /metrics reachable from host"    'curl -sf --max-time 5 "$LLM_METRICS_URL" | grep -q "^vllm:"'       "metrics stay null; benchmark model_calls unknown (runbook R5)"
  req "structured tool-call output"          'LLM_BASE_URL=$LLM_BASE_URL python3 -m app check-llm | grep -q "\"structured_output_ok\": true"' "try the other model / check parser flags (runbook R2)"
  info "served models + max_model_len" 'curl -s --max-time 5 "${AUTH[@]}" "$LLM_BASE_URL/models" | grep -o "\"\(id\|max_model_len\)\": *[^,]*"' 4
  info "check-llm elapsed_s" "LLM_BASE_URL=$LLM_BASE_URL python3 -m app check-llm | grep -E 'elapsed_s|model\"'" 2
  info "versions" 'nemoclaw --version; openshell --version; sbx openclaw --version' 3
  info "sandboxes" 'nemoclaw list' 5
}

gate2() {  # sandbox -> trusted host tool service
  GATE=2; log "== GATE 2: host tool service boundary ($(date -Is))"
  B=$(bridge)
  req "bridge gateway IP found"              '[ -n "$B" ]'                                          "set BRIDGE=<ip> (docker network ls; inspect the openshell network)"
  req "service on $B:$PORT rejects no-token" '[ "$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://$B:$PORT/call")" = 401 ]' "APP_AGENT_TOOLS=... python3 -m app serve --bind $B --port $PORT &"
  req "service NOT on 0.0.0.0"               '! ss -ltn | grep -q "0.0.0.0:$PORT"'                  "restart serve with --bind $B"
  req "host-tools policy applied"            'nemoclaw "$SANDBOX" policy list | grep -q host-tools'  "runbook Gate 2 policy step (dry-run first)"
  req "sandbox resolves $REMOTE_HOST"        'sbx getent hosts "$REMOTE_HOST"'                       "DNS: runbook decision tree D1"
  info "$REMOTE_HOST resolves to (compare with BRIDGE=$B)" 'sbx getent hosts "$REMOTE_HOST"'
  SKILL_DIR=${SKILL_DIR:-$(sbx sh -c 'for f in /sandbox/.openclaw/skills/records-ops/client.py /sandbox/.openclaw/*/skills/records-ops/client.py /sandbox/.openclaw/workspace*/skills/records-ops/client.py; do [ -f "$f" ] && dirname "$f" && break; done' 2>/dev/null)}
  info "skill dir" 'echo "$SKILL_DIR"'
  req "records-ops skill installed (remote package)" '[ -n "$SKILL_DIR" ] && sbx test -f "$SKILL_DIR/client.json"' "APP_REMOTE=http://$REMOTE_HOST:$PORT/call bash scripts/package_skill.sh && nemoclaw $SANDBOX skill install ./dist/records-ops/"
  req "NO app source/DB in sandbox skill dir" '! sbx test -e "$SKILL_DIR/app"'                       "you installed the --local package; rebuild the REMOTE package"
  req "sandbox client -> read_records ok"    'sbx python3 "$SKILL_DIR/client.py" read_records "{}" | grep -q "\"ok\": true"' "decision tree D2-D6 (client prints the error code)"
  info "client error code if any" 'sbx python3 "$SKILL_DIR/client.py" read_records "{}" | grep -o "\"code\": \"[a-z_0-9]*\""'
  req "privileged tool refused from sandbox" 'sbx python3 "$SKILL_DIR/client.py" decide_approval "{}" | grep -q unknown_tool' "STOP: boundary broken"
  req "openclaw sees records-ops"            'sbx openclaw skills list | grep -q records-ops'         "new session needed? check skill path precedence (runbook R2)"
  before=$(python3 -c 'from app import db; print(db.connect().execute("SELECT COALESCE(MAX(id),0) FROM tool_calls").fetchone()[0])')
  mkdir -p results/gate2
  req "REAL agent calls read_records (host DB shows the call)" \
      'sbx openclaw agent --session-id "preflight-$$" -m "Use the records-ops skill to call read_records and tell me how many records exist." --json --timeout 600 > results/gate2/captured_agent.json; python3 -c "from app import db; import sys; sys.exit(0 if db.connect().execute(\"SELECT 1 FROM tool_calls WHERE id>? AND tool=\x27read_records\x27\", ($before,)).fetchone() else 1)"' \
      "agent didn't use the tool: skill visible? model tool parser? runbook R2/R4"
  req "openclaw --json matches our parser contract" \
      'python3 -c "import sys,json; from app.bench import parse_agent_json as p; r=p(open(\"results/gate2/captured_agent.json\").read()); print(json.dumps(r)); sys.exit(1 if r[\"schema_errors\"] else 0)"' \
      "cp results/gate2/captured_agent.json tests/fixtures/openclaw/captured_gb10.json; adjust AGENT_JSON_FIELDS (critical-bug exception, log it)"
}

gate3() { GATE=3; log "== GATE 3: autonomous skill generation ($(date -Is))"
  req "agent-written skill from a REAL task, not the fixture" 'python3 scripts/gate_evidence.py gate3 >> "$LOG"' "runbook Gate 3 (no fixture swap, ever)"; }
gate4() { GATE=4; log "== GATE 4: hidden validation + human approval ($(date -Is))"
  req "hidden suite passed, human approved, sha pinned" 'python3 scripts/gate_evidence.py gate4 >> "$LOG"' "runbook Gate 4 / R6"; }
gate5() { GATE=5; log "== GATE 5: reuse + A/B/C benchmark ($(date -Is))"
  req "real benchmark evidence ($RESULT)" 'python3 scripts/gate_evidence.py gate5 "$RESULT" >> "$LOG"' "runbook Gate 5"; }

case "${1:-all}" in
  gate0|gate1|gate2|gate3|gate4|gate5) "$1" ;;
  all) gate0; gate1; gate2 ;;
  *) echo "usage: $0 gate0|gate1|gate2|gate3|gate4|gate5|all"; exit 2 ;;
esac
[ $fails = 0 ] && log "RESULT: GO (${1:-all})" || log "RESULT: NO-GO (${1:-all}): $fails failing check(s)"
printf '{"ts":"%s","gate":"%s","result":"%s","fails":%s}\n' "$(date -Is)" "${1:-all}" "$([ $fails = 0 ] && echo GO || echo NO-GO)" "$fails" >> "$JL"
exit $((fails > 0))
