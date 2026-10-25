#!/usr/bin/env bash
# Build the OpenClaw skill folder at dist/records-ops/ for: nemoclaw my-assistant skill install ./dist/records-ops/
#
#   APP_REMOTE=http://host.openshell.internal:8765/call bash scripts/package_skill.sh   REMOTE (default)
#       ships ONLY SKILL.md + client.py + client.json (url + agent token). No DB, no app source, no verifier,
#       no scenario data, no hidden suite inside the sandbox. Trusted state lives with `python -m app serve` on the host.
#   bash scripts/package_skill.sh --local                                      LOCAL fallback
#       ships the full app into the sandbox (agent can read/modify it; see docs/ARCHITECTURE.md trust table).
set -euo pipefail
cd "$(dirname "$0")/.."
out=dist/records-ops
rm -rf "$out" && mkdir -p "$out"
cp adapters/openclaw/skill/SKILL.md adapters/openclaw/client.py "$out/"

if [ "${1:-}" = "--local" ]; then
  mkdir -p "$out/data" "$out/adapters"
  cp -r app "$out/"
  cp adapters/llm.py "$out/adapters/"
  cp data/scenario.json "$out/data/"
  cp -r data/learning "$out/data/"
  find "$out" -name __pycache__ -prune -exec rm -rf {} +
  rm -f "$out/app/flywheel.py" "$out/app/bench.py" "$out/app/server.py"  # dev/host-only modules
  echo "built LOCAL $out (full app inside the sandbox; weaker trust boundary)"
else
  : "${APP_REMOTE:?set APP_REMOTE=http://host.openshell.internal:8765/call (docs/GB10_RUNBOOK.md Gate 2)}"
  token=$(python3 -c 'from app import server; print(server.token())' 2>/dev/null || python -c 'from app import server; print(server.token())')
  printf '{"remote": "%s", "token": "%s"}\n' "$APP_REMOTE" "$token" > "$out/client.json"
  echo "built REMOTE $out -> $APP_REMOTE (only SKILL.md, client.py, client.json)"
fi
