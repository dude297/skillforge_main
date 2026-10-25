# OpenClaw CLI contract fixtures — NOT real OpenClaw output

These files are hand-written from the Gateway `--json` shape read in the openclaw 2026.9.2 SOURCE
(src/commands/agent-via-gateway.ts, src/agents/embedded-agent-runner/types.ts), not captured output. They test our parser and the harness, not OpenClaw. Replace `agent_ok.json` with a
captured real response at Gate 2 (`openclaw agent ... --json > tests/fixtures/openclaw/captured_gb10.json`) and
the contract test will check the real shape too.
