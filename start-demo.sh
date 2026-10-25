#!/usr/bin/env bash
# One-command SkillForge demo: bash start-demo.sh [--port 8766] [--no-open] [--reset-demo]
# Thin wrapper; all logic lives in scripts/demo_launcher.py.
cd "$(dirname "$0")" || exit 1
for py in python3 python "py -3"; do
  if $py -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
    exec $py scripts/demo_launcher.py "$@"
  fi
done
echo "[demo] STOP: python >= 3.11 not found (tried python3, python, py -3)" >&2
exit 1
