SYNC PACKET to-dell-001
Origin: Windows laptop
UTC: 2026-10-25
State: PROGRESS
Running commit (GB10): unknown to laptop. Report it in your first packet.
Branch/commit referenced: demo/oncall @ c040cd5 (bundle skillforge-gb10-c040cd5.tar.gz,
  sha256 eabaab05877677600629e0113c20d765a20ceb5ebdb373e82b6052c74b9e12f5)
Dell must restart/replace anything? NO. Keep running c040cd5. Laptop updates arrive as a NEW side-by-side bundle with a numbered packet; never replace in place.

# Standing orders for the Dell Claude

1. **Report after every queue item and on any state change** with a `from-dell/NNN-*.md` packet (see README). Required states:
   - `DONE`: an item finished, with evidence dirs and SHA256.
   - `BLOCKED`: verbatim error, what you tried (max 2 attempts), and what you are doing instead.
   - `STANDBY`: you have nothing executable. **Never sit in STANDBY.** Report it, then immediately take the next item from the STANDBY FILLERS below.
2. Work the queue top-down. If an item is blocked, report it and go on to the next independent one.
3. Truth rules: never present recorded, mock or `--local` output as live. Unknown numbers stay null. A model-written skill that fails verification is a valid result, so report it as-is. Never substitute the recorded skill.
4. Never weaken isolation: Docker runner flags, host-tools scope, no 0.0.0.0 binds, the core 15 s sandbox timeout.
5. A PERSON must type the `skill approve ... --by "<name>"` command. You never approve.
6. Copy every `results/gb10-evidence/*` dir to `/media/dell/Extreme SSD/SkillForge/evidence/` and list its SHA256 in the packet (`find <dir> -type f -exec sha256sum {} +`).

# Queue (P0 first)

| # | Item | Command(s) | Done when |
|---|------|-----------|-----------|
| D1 | Real Qwen inference serving | per docs/GB10_RUNBOOK.md Gate 1; then `bash deploy/gb10/sf-gb10.sh preflight` | preflight PASS (health + /v1/models + real check-llm). Report the served model id, vLLM version and `nvidia-smi` output |
| D2 | Live OnCall INC-1 | `bash deploy/gb10/sf-gb10.sh oncall` → human approves → | evidence dir; lint/own tests/INC-1 replay/hidden suite results verbatim |
| D3 | Reuse + refusal | `bash deploy/gb10/sf-gb10.sh reuse` | INC-2 reused with 0 model calls (measured latency); INC-3 REFUSED |
| D4 | Bench | `bash deploy/gb10/sf-gb10.sh bench` | TTFT, decode tok/s, GPU memory, temperature, plus the evidence dir |
| D5 | Live console rehearsal | `bash deploy/gb10/sf-gb10.sh demo` → walk http://127.0.0.1:8766/#/demo | console shows THIS run labelled live. Time the walkthrough and note any UI defect (screen + steps) |
| D6 | Repeatability | repeat D2–D4 on a fresh state dir 2 more times (n=3) | per-run pass/fail + latencies, so we can quote a success rate rather than one anecdote |
| D7 | Gates 0–5 (full pipeline, optional if time) | `bash scripts/gb10_preflight.sh gate0` … `gate5`, each `| tee results/gateN.txt` | gate results |

# STANDBY FILLERS (use while waiting on a download, a model load or a human)
- F1: Docker runner floor (GB10_BENCH_RUNBOOK M2b), 12 runs → `results/gb10_bench/docker_floor.txt`.
- F2: Cold vs warm first request: record `python3 -m app check-llm` elapsed right after model load, then 5× warm.
- F3: Fault rehearsal: stop the vLLM container mid-`oncall` on a throwaway state dir. Confirm a loud failure (exit 2, nothing written), then restart vLLM. Report the verbatim output.
- F4: Demo-from-clean rehearsal: new terminal and clean browser profile; run the full demo route twice and time it.
- F5: Capture host facts for the judges: `nvidia-smi -q | head -60`, `free -g`, `docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}'`, `uname -a`. No hostnames or usernames in the packet.
- F6: Read docs/LIVE_DEMO_RUNBOOK.md and docs/JUDGE_QA.md on the box. Report any instruction that is wrong for this machine.

Next command for Dell: report your current state and running commit in from-dell/001-status.md, then start D1 (or continue it).
