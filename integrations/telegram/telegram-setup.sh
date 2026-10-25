#!/usr/bin/env bash
# Telegram channel setup for NemoClaw. Idempotent. Never prints the token.
# Usage: telegram-setup.sh [--check] [--sandbox NAME]
# Env:   SANDBOX (default skillforge), SF_CONF (default ~/.config/skillforge)
set -euo pipefail

SANDBOX="${SANDBOX:-skillforge}"
CONF="${SF_CONF:-$HOME/.config/skillforge}"
TOKEN_FILE="$CONF/telegram_token"
IDS_FILE="$CONF/telegram_allowed_ids"
CHECK=0

while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --sandbox) shift; SANDBOX="${1:?--sandbox needs a name}" ;;
    -h|--help) sed -n 2,5p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

fails=0
ok()   { echo "  [ok]   $*"; }
bad()  { echo "  [FAIL] $*"; fails=$((fails + 1)); }
mode() { stat -c %a "$1" 2>/dev/null || echo none; }

echo "== prerequisites (sandbox: $SANDBOX) =="
if [ -d "$CONF" ]; then
  [ "$(mode "$CONF")" = 700 ] && ok "dir $CONF mode 700" || bad "dir $CONF mode $(mode "$CONF"), want 700"
else
  bad "dir $CONF missing"
fi
if [ -f "$TOKEN_FILE" ]; then
  [ "$(mode "$TOKEN_FILE")" = 600 ] && ok "token file mode 600" || bad "token file mode $(mode "$TOKEN_FILE"), want 600"
  [ -s "$TOKEN_FILE" ] && ok "token file non-empty" || bad "token file empty"
else
  bad "token file $TOKEN_FILE missing"
fi
if [ -f "$IDS_FILE" ]; then
  [ "$(mode "$IDS_FILE")" = 600 ] && ok "allowed-ids file mode 600" || bad "allowed-ids file mode $(mode "$IDS_FILE"), want 600"
  if grep -Eqx '[0-9]+(,[0-9]+)*' <(tr -d ' \n' < "$IDS_FILE"); then ok "allowed ids look numeric"; else bad "allowed ids must be comma-separated numbers"; fi
else
  bad "allowed-ids file $IDS_FILE missing (without it NemoClaw requires device pairing)"
fi
if command -v nemoclaw >/dev/null 2>&1; then ok "nemoclaw on PATH"; else bad "nemoclaw not on PATH"; fi
if getent hosts api.telegram.org >/dev/null 2>&1; then ok "DNS resolves api.telegram.org"; else bad "DNS does not resolve api.telegram.org"; fi

if [ "$CHECK" = 1 ]; then
  echo "== check only: $fails problem(s); no API calls made =="
  [ "$fails" -eq 0 ]; exit
fi
if [ "$fails" -ne 0 ]; then
  echo "refusing to run: $fails prerequisite(s) failed (use --check)" >&2
  exit 1
fi

TELEGRAM_BOT_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
TELEGRAM_ALLOWED_IDS="$(tr -d '[:space:]' < "$IDS_FILE")"
export TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_IDS
# DM only for the demo (names from NemoClaw docs; FROM DOCS, unverified)
export TELEGRAM_REQUIRE_MENTION="${TELEGRAM_REQUIRE_MENTION:-1}"
export TELEGRAM_GROUP_POLICY="${TELEGRAM_GROUP_POLICY:-disabled}"
# channels add rebuilds the sandbox non-interactively. Without the provider env the inner onboard cannot
# re-select the loopback no-auth Qwen endpoint (onboard.ts: non-interactive needs AUTH_MODE=none), the
# recreate fails at provider_selection and the old sandbox is already deleted.
export NEMOCLAW_NON_INTERACTIVE=1 NEMOCLAW_COMPATIBLE_AUTH_MODE=none NEMOCLAW_PROVIDER=custom \
  NEMOCLAW_ENDPOINT_URL="${NEMOCLAW_ENDPOINT_URL:-http://127.0.0.1:8000/v1}" \
  NEMOCLAW_MODEL="${NEMOCLAW_MODEL:-skillforge-qwen}" NEMOCLAW_NO_EXPRESS=1 NEMOCLAW_DISABLE_TELEMETRY=1

echo "== channels add telegram (rebuilds the sandbox) =="
if nemoclaw "$SANDBOX" channels status --channel telegram >/dev/null 2>&1; then
  echo "telegram channel already present for $SANDBOX; skipping add (remove it first to change token)"
else
  nemoclaw "$SANDBOX" channels add telegram
fi

echo "== egress policy =="
nemoclaw "$SANDBOX" policy list || true
# The docs show both 'policy add' and 'policy-add'; try the documented form first.
if nemoclaw "$SANDBOX" policy list 2>/dev/null | grep -qi telegram; then
  echo "telegram preset already applied"
else
  nemoclaw "$SANDBOX" policy add telegram --dry-run \
    || nemoclaw "$SANDBOX" policy-add telegram --dry-run || true
  nemoclaw "$SANDBOX" policy add telegram --yes || nemoclaw "$SANDBOX" policy-add telegram
fi

unset TELEGRAM_BOT_TOKEN TELEGRAM_ALLOWED_IDS
cat <<NEXT
== next steps ==
1. nemoclaw $SANDBOX rebuild --yes     (only if the rebuild was deferred)
2. DM your bot from an allowed account; watch: nemoclaw $SANDBOX logs --follow --since 5m
3. Check egress: openshell term   (expect only api.telegram.org:443)
4. Approvals stay on the host: python3 -m app approve <id> --by <name>
NEXT
