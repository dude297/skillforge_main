# Gaps for a real (non-simulated) Telegram path

Status 2026-10-25: the **Telegram <-> local model** round trip is VERIFIED on the GB10 (OpenShell OCSF: getUpdates -> inference.local
-> sendChatAction -> sendMessage, all ALLOWED by policy `telegram_bot`; the OpenClaw binary is `/usr/local/bin/node`). The gaps
below concern the **Telegram -> SkillForge tools** hop, which is not verified. OpenClaw in the sandbox -> SkillForge host tools (records-ops) is verified separately (Gate 2, 13/13).

## Missing pieces (file -> change)
1. Nothing in the repo is installed or configured for the channel: NemoClaw owns it (`channels add telegram`, or Telegram configured
   at onboarding). No SkillForge code is required for the "Telegram -> agent -> tool service" path.
2. `adapters/openclaw/presets/host-tools.yaml` (`allowed_ips: __BRIDGE__/32`, binary `/usr/bin/python3`): applied on the GB10 after a
   dry run for Gate 2 (policy `host-tools`, allowed IP `172.18.0.1/32`). No negative test is recorded.
3. Tool service reachability: `python -m app serve` defaults to 127.0.0.1:8765; the sandbox needs it bound to the openshell docker
   bridge gateway (that network exists only after NemoClaw is up). Gate 2 ran it with `--bind 172.18.0.1 --port 8765` (no code
   change). A launcher that discovers the bridge IP does not exist.
4. Skill: only `records-ops` exists (`adapters/openclaw/skill/SKILL.md`, `scripts/package_skill.sh` is hard-wired to
   dist/records-ops). An OnCall/incident Telegram demo needs a new or extended skill and packaging.
5. The sender's identity does not reach SkillForge on the OpenClaw path (ENTERPRISE_SLICE.md gap), so the audit cannot attribute a
   call to the Telegram user. Fix: pass the sender id from the bridge into `client.py` args and `app/server.py` (needs OpenClaw
   support, unverified), or accept allowlist-only attribution.
6. `experiments/channel/contract.py`: no `telegram` entry in `CHANNELS` (a test asserts telegram is refused). Only needed for the
   host-side router path instead of OpenClaw: a (telegram, bot id) mapping, user-id allowlist, assurance `allowlist_only`, and a real
   transport (listener + sender). NOT BUILT.
7. No approval-pending notifier and no Telegram approve path. Keep it that way; a one-way host-side notification would need token
   access on the host, which is a separate decision.
8. `app/server.py` is single-threaded: a long call blocks the others.
9. `docs/GB10_RUNBOOK.md` R12 uses `channels status`, which is not confirmed in the NemoClaw docs. `telegram-setup.sh` uses it only as
   an idempotency probe and tolerates failure.
10. `telegram-egress.yaml` rule paths are guesses. The binary is now VERIFIED as `/usr/local/bin/node` (OCSF), and the built-in
    `telegram` preset is what the live sandbox uses.

## Claims that must stay "simulated" until each is verified
- CLAIMS.md #26 (messaging channel delivers tasks): "Telegram <-> local model round trip verified" only. It becomes "done" when a real
  Telegram message produces a reply AND a SkillForge tool call in the host audit.
- WORKFLOW_FREIGHT.md / `scripts/unified.py` (`SIM_META` slack channel, scripted mock agent): remain SIMULATED.
- ENTERPRISE_SLICE.md "trusted identity" row: stays "partly met" (allowlist only).
- Egress policy: partly verified. OCSF shows only api.telegram.org, inference.local, and a DENIED telemetry.openclaw.ai.
- Any statement that approvals work "via Telegram" must not be made; approvals are host-CLI only.
