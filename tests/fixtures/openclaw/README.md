# OpenClaw CLI contract fixtures — NOT real OpenClaw output

These files are hand-written from the Gateway `--json` shape read in the openclaw 2026.9.2 SOURCE
(src/commands/agent-via-gateway.ts, src/agents/embedded-agent-runner/types.ts), not captured output. They test our parser and the harness, not OpenClaw. A captured real response
(`openclaw agent ... --json > tests/fixtures/openclaw/captured_gb10.json`) is not in this tree, so the contract test checks only
the hand-written shape.
