# GB10 runbook: first boot to demo

**Feature freeze:** on site, change the SkillForge core only to fix a critical bug, and log every such change in `results/CHANGES_ON_SITE.md`.

**How to work through it:**
- Do the gates **in order**. A gate is GO only when its `scripts/gb10_preflight.sh gateN` line says `RESULT: GO`.
- The script writes a human-readable log to `data/preflight.log` and a machine-readable one to `data/preflight.jsonl`.
- Evidence goes in `results/` (gitignored), then gets copied to the USB.

**Gate status on the GB10 (2026-10-25, GB10 operator report):** Gate 2 is GO (13/13, records-ops tools through the applied `host-tools` policy; [CLAIMS.md](CLAIMS.md) #23c). Gate 3 (OpenClaw driving the OnCall synthesis and verification) is NOT PASSED: the pipeline works end to end but no candidate passed the independent verifier (0 accepted; [CLAIMS.md](CLAIMS.md) #23b). Gate 4 (promotion) did not apply, since nothing was staged. The OnCall synthesis, approval and reuse themselves ran on the GB10 through `deploy/gb10/sf-gb10.sh` and the host harness ([BENCHMARKS.md](BENCHMARKS.md#3-gb10-live-measurements-2026-10-25)). A GO record for Gates 0, 1 and 5 is not in this repository.

**Related docs:**
- Pins and sizes: [DEPLOY_MANIFEST.md](DEPLOY_MANIFEST.md)
- Background: [GB10_SETUP.md](GB10_SETUP.md), [SKILLFORGE.md](SKILLFORGE.md)
- Demo script: [DEMO_GUIDE.md](DEMO_GUIDE.md)

```bash
export NEMOCLAW_DISABLE_TELEMETRY=1 SANDBOX=my-assistant
```

## Gate 0: host, Docker, memory, security tests (about 15 minutes; no model needed)

```bash
STAGE=/media/$USER/<usb>/gb10-stage
(cd $STAGE && sha256sum -c --quiet SHA256SUMS && echo CHECKSUMS PASS)
git clone -q $STAGE/repo/local-agent-foundation.bundle ~/app && cd ~/app && git checkout prep/readiness   # or the online backup
bash scripts/offline.sh restore $STAGE          # docker load runner image + pytest from wheels
mkdir -p results && date -Is > results/START
bash scripts/gb10_preflight.sh gate0 | tee results/gate0.txt
```

**Expected:** every line PASS, ending in `RESULT: GO (gate0)`. The full test suite runs on real ARM64, including the Docker isolation, the 512 MB memory kill, CapEff=0, pids<64, and `RLIMIT_AS`.

**Evidence to save:** `results/gate0.txt`, `data/preflight.jsonl`, plus the INFO lines (OS, `/etc/dgx-release`, driver, RAM).

**If it fails:**

| failure | do this |
|---|---|
| `nvidia-smi` | wrong machine, or the driver isn't loaded. Ask staff. Don't install drivers. |
| docker needs sudo | `sudo usermod -aG docker $USER` and log in again. **This is a host change: ask first.** |
| `RLIMIT_AS` test fails | Expected risk from QEMU (see §5). Continue **only** with `SKILL_RUNNER=docker`, which is required for the trusted run anyway. Log it. |
| docker isolation tests fail | Go to R3. **Stop:** never run the trusted acceptance without the Docker runner. |
| < 60 GB free | Free space. Don't delete anything that isn't ours. |

**Stop/go:** GO means go to Gate 1. If the Docker runner is NO-GO, you can still do Gates 1–2, but the most you can claim is demo level 3.

## Gate 1: NemoClaw and local inference (30–60 minutes, mostly downloads and model load)

```bash
nemoclaw --version || {   # only if not preinstalled; it's a system install, so confirm with the team
  export NEMOCLAW_INSTALL_TAG=v0.0.135; curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash && source ~/.bashrc; }
nemoclaw profiles list | grep dgx-spark-gb10                 # expect ...qwen3-6-35b-a3b-nvfp4 (supported)
# NemoClaw's vLLM uses bearer auth; the key is a 0600 file (NemoClaw source, LKG v0.0.135):
export LLM_API_KEY=$(cat ~/.nemoclaw/dual-station-vllm-api-key) LLM_BASE_URL=http://127.0.0.1:8000/v1 LLM_METRICS_URL=http://127.0.0.1:8000/metrics
nemoclaw inference get --json                                # which model the sandbox route points at
time (until curl -sf -H "Authorization: Bearer $LLM_API_KEY" $LLM_BASE_URL/models >/dev/null; do sleep 5; done)   # = load time
python3 -m app check-llm >/dev/null                          # warm-up; the cold run is excluded from numbers
bash scripts/gb10_preflight.sh gate1 | tee results/gate1.txt
python3 -m app models probe | tee results/probe.json   # native tool call + 2-step; REQUIRED before Gate 3 learning
python3 -m app db backup                                # checkpoint before any agent work
```

**Expected:** `vLLM serves a model`, `/metrics reachable` and `structured tool-call output` all PASS.

**Evidence to save:** the model id, `max_model_len`, load time, warm `elapsed_s`, and the versions INFO line (nemoclaw, openshell, openclaw).

**If it fails:**

| failure | do this |
|---|---|
| `/models` 401 | `LLM_API_KEY` is wrong or unset. |
| connection refused | R1b. |
| `structured_output_ok` false | Warm up and retry once, then R2. |
| `/metrics` fails | Continue. `model_calls` stays **null** and break-even shows as **pending** (R5). |

**Stop/go:**
- GO means go to Gate 2.
- Inference NO-GO after 60 minutes means demo level 5 (mock, labelled), and ask staff.

## Gate 2: OpenClaw to trusted host-tool round trip (about 20 minutes)

```bash
BRIDGE=$(docker network inspect openshell-docker -f '{{(index .IPAM.Config 0).Gateway}}'); echo "$BRIDGE"   # `docker network ls` if empty
export SKILL_RUNNER=docker
APP_AGENT_TOOLS=read_records,investigate,propose_action,request_approval,execute_action,verify_action,get_audit,search_skills,run_skill,propose_skill \
  nohup python3 -m app serve --bind "$BRIDGE" --port 8765 > data/serve.log 2>&1 &
sed "s#__BRIDGE__#$BRIDGE#" adapters/openclaw/presets/host-tools.yaml > /tmp/host-tools.yaml
nemoclaw $SANDBOX policy add --from-file /tmp/host-tools.yaml --dry-run      # must validate; read the merged output
nemoclaw $SANDBOX policy add --from-file /tmp/host-tools.yaml --yes
APP_REMOTE=http://host.openshell.internal:8765/call bash scripts/package_skill.sh   # remote package: SKILL.md, client.py, client.json only
nemoclaw $SANDBOX skill install ./dist/records-ops/
python3 -m app reset --scenario data/learning/learn_a.json
BRIDGE=$BRIDGE bash scripts/gb10_preflight.sh gate2 | tee results/gate2.txt
```

**Expected:**
- 401 without a token, and the service is not on 0.0.0.0
- the sandbox resolves `host.openshell.internal`
- the client's `read_records` returns ok, and `decide_approval` returns `unknown_tool`
- there is no `app/` in the skill dir
- **the host DB shows the real agent's `read_records`**
- the captured `openclaw agent --json` passes our parser contract

**Evidence to save:**
- `results/gate2/captured_agent.json`: copy it to `tests/fixtures/openclaw/captured_gb10.json`, which turns the contract test from a skip into a real check
- `python3 -m app call get_audit '{}' > results/gate2/audit.json`

**If it fails:** use the network decision tree in §3.

**If the contract check fails:** the JSON shape differs from what openclaw 2026.9.2's source says. Fixing `AGENT_JSON_FIELDS` in `app/bench.py` is an allowed critical fix; log it.

**Stop/go:**
- GO means go to Gate 3.
- NO-GO after 45 minutes means you may use the `--local` package **only as demo level 4, labelled insecure**. Never widen the policy and never bind 0.0.0.0.

## Gate 3: real autonomous skill generation (20–40 minutes, model-bound)

Run this by hand so a human does the approvals and every hint is visible:

```bash
mkdir -p results/gate3; S=g3-$(date +%s)
A() { nemoclaw $SANDBOX exec --no-tty -- openclaw agent --session-id $S --json --timeout 900 -m "$1"; }
python3 -m app reset --scenario data/learning/learn_a.json
python3 -m app task begin "gate3 learn" --mode real
A "Records may have wrong totals. Check them all with the records-ops skill and fix what's wrong." > results/gate3/1_solve.json
python3 -m app pending                                      # read what the agent proposed
python3 -m app approve <action ids> --by <your name>        # a HUMAN, on the host
A "Approved. Execute the approved actions, verify each, and report." > results/gate3/2_execute.json
A "If the fix you just made is repeatable, turn it into a skill (records-ops step 5)." > results/gate3/3_learn.json   # MANUAL HINT #1
python3 -m app task end
python3 -m app skill list
bash scripts/gb10_preflight.sh gate3 | tee results/gate3.txt
```

**Expected:** `gate_evidence.py gate3` passes:
- the skill comes from a `mode='real'` task
- its candidate files are on the host
- it is **not** the mock fixture
- it has status `tested`, meaning its self-tests and replay passed

**Evidence to save:**
- `results/gate3/*.json`
- `skills/candidates/<name>/v1/`
- every prompt you typed, verbatim, in `results/HINTS.md`

**If it fails:**

| failure | do this |
|---|---|
| `nothing_verified` | The fix wasn't executed and verified. Check `python3 -m app audit`. |
| status `failed_tests` | Allowed: one revision prompt, "Your skill failed its own tests: <the propose_skill error the agent already saw>. Revise it with propose_skill (same name)." That's hint #2. |
| the model doesn't write a skill after 2 hints | Gate 3 is NO-GO. |

**Never copy the fixture.** The gate refuses it, and so must we.

**Stop/go:**
- GO means go to Gate 4.
- NO-GO means demo level 3: a real agent plus the trusted boundary, with learning shown only through the **mock** flywheel, labelled.

## Gate 4: hidden validation and human approval (about 5 minutes)

```bash
python3 -m app skill approve <name> <version> --by <your name>   # runs the hidden suite on the HOST, pins sha256, activates
bash scripts/gb10_preflight.sh gate4 | tee results/gate4.txt
python3 -m app skill list > results/gate4_skills.json
```

**Expected:** the hidden suite passes (`hidden_ok = 1`), the skill is `approved` by a named human, it is active, and its sha256 is pinned.

**If it fails:**
- **Hidden suite fails:** that's a real, valid result (R6). Give one revision prompt (record it), then `skill approve` again. **Don't edit the suite.**
  - The prompt says only "it failed independent validation". **Never paste hidden case names, inputs or expected values to the agent**: that leaks the oracle and turns validation into training data.
  - `propose_skill` accepts at most 5 unapproved versions per name.
- **Still failing:** Gate 4 is NO-GO, which means demo level 3 with an honest statement that the model's skill failed independent validation.

**Stop/go:** GO means go to Gate 5.

## Gate 5: reuse and the A/B/C benchmark (30–60 minutes, model-bound)

```bash
nemoclaw $SANDBOX exec -- ls /sandbox/.openclaw/agents/main/ 2>/dev/null   # note memory files (sessions are fresh per trial)
python3 -m app bench --agent openclaw --trials 3 --reuse-skill --db data/app.db --skills-dir skills --out results/gate5 \
        --cases unseen_compatible,lookalike_fingerprint,incompatible,skill_fails_verification | tee results/gate5_report.md
bash scripts/gb10_preflight.sh gate5 | tee results/gate5.txt     # reads results/gate5/result.json
```

**Expected:**
- real model, with no agent CLI or contract errors
- trials ran in modes A and C
- every trial is correct against ground truth
- `model_calls` was measured

**Notes:**
- The first trial of each (case, mode) is the cold number (`first_s`). `median_s ± mad_s` is the warm number.
- Break-even is valid only when `model_calls` is not null for both A and C. Otherwise report it as **pending**.

**If it fails:**

| failure | do this |
|---|---|
| a hang | R8: rerun one case with `--trials 1`. |
| a `WARNING ... --json contract` line | Go back to Gate 2's contract check. |
| some trial is wrong | Report it. Don't rerun until it looks good. |

**Stop/go:** GO means demo level 1. If you're short on time, `--trials 1 --cases unseen_compatible --modes A,C` and say "n=1".

### Optional after Gate 5 GO: model bake-off (time-box 90 minutes)

```bash
git archive exp/scenarios experiments | tar -x -C /tmp           # OnCall fixture for the patch probe
python3 -m app bakeoff run --label qwen36 --reps 3 --oncall /tmp/experiments/oncall
mkdir -p results/bakeoff/qwen36 && cp results/gate5/result.json results/bakeoff/qwen36/
# Switching profile re-onboards and may rebuild the sandbox (then redo the Gate 2 install steps). EXPERIMENTAL:
nemoclaw onboard --profile vllm.dgx-spark-gb10.single.nemotron-3.5-lightning-30b-a3b-nvfp4
python3 -m app bakeoff run --label lightning --reps 3 --oncall /tmp/experiments/oncall
python3 -m app bench --agent openclaw --trials 3 --reuse-skill --db data/app.db --skills-dir skills --out results/bakeoff/lightning \
        --cases unseen_compatible,lookalike_fingerprint,incompatible,skill_fails_verification
python3 -m app bakeoff compare results/bakeoff/* | tee results/bakeoff/COMPARE.md
```

Rank models by success and reliability first, latency second. DGX Spark numbers do not transfer to the Dell by assumption.

## 1. Demo levels (go/no-go)

| state reached | demo we give | what we can honestly claim |
|---|---|---|
| 1. Gate 5 GO | **Full:** learn → hidden-validate → approve → deterministic reuse, with the A vs C table | measured reduction in model calls and latency on an equivalent workload |
| 2. Gate 4 GO | learn plus one reuse on new data (C), and the lookalike refusal | autonomous skill creation with trusted reuse; numbers are "n=1" |
| 3. Gate 2 GO | the agent investigates and fixes through the trusted service; the approval gate; then the **mock** flywheel, labelled | trusted boundary plus a real agent; learning shown on infrastructure only |
| 4. Gate 1 GO | the real agent with the **`--local` package, labelled as the insecure fallback** | a real local agent plus approvals; **not** a trusted-boundary claim |
| 5. Gate 1 NO-GO | `python -m app demo` + `bench` (mock), labelled | architecture only |

**Hard rules:**
- Never present `--local`, mock or fixture results as trusted or autonomous.
- Never widen `host-tools.yaml`, bind to 0.0.0.0, or drop the Docker runner to make something pass.

## 2. Recovery

| id | symptom | action (in order) |
|---|---|---|
| R1 | the sandbox is unhealthy, or the gateway is down | `nemoclaw $SANDBOX status`, then `nemoclaw $SANDBOX recover`, then `nemoclaw $SANDBOX rebuild --yes`. If port 8080 is busy: `nemoclaw onboard --resume`. |
| R1b | vLLM is down or out of memory | `docker ps -a \| grep vllm`, then `docker logs nemoclaw-vllm \| tail -50`. Unified memory: page cache counts. Running `sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'` is a host action, so ask first. Fall back to the Qwen profile. |
| R2 | `structured_output_ok` is false, or the agent never calls tools | 1. Warm up and retry once. 2. Check `openclaw skills list` shows records-ops. 3. Start a **new session id** (skills are snapshotted per session). 4. Switch profile. 5. Shorten the SKILL.md procedure (text, not code). |
| R3 | the Docker runner fails | 1. `docker image inspect python:3.12-slim -f '{{.Architecture}}'` must be arm64. 2. `docker run --rm --network none python:3.12-slim python -V`. 3. For cgroup errors in `docker info`, ask staff. **Do not** fall back to the subprocess runner for the trusted acceptance without saying so. |
| R4 | the sandbox can't reach the service | §3, the decision tree |
| R5 | `/metrics` is unreachable | `model_calls` stays null. Use the OpenClaw `--json` `result.meta.toolSummary.calls` and `agentMeta` as a *manual count*, and label it that way. |
| R6 | the agent's skill fails hidden validation | That's a valid result. Allow one revision, record the hint, and **never** swap in the fixture. |
| R7 | the DB is in a bad state | Stop `serve`, `cp data/app.db data/app.db.bak-$(date +%s)`, then `python3 -m app reset --scenario ...`. Skills and tasks survive a reset. |
| R8 | a trial hangs | The agent turn timeout is 900 s. Kill it, then rerun with `--reuse-skill --cases <that case> --trials 1`. |
| R10 | NemoClaw not installed, and no network | Stop: it can't be staged offline. Ask staff. Meanwhile run `python3 -m app fastpath` (no-model mode) and the mock demo, labelled. |
| R11 | runner image missing | `bash scripts/offline.sh restore <stage>` (runs `docker load`). Never point `SKILL_RUNNER_IMAGE` at an unverified image. |
| R12 | messaging channel down | `nemoclaw $SANDBOX channels status --channel telegram --json`, then `channels stop`/`start`. Demo through `openclaw tui` or `nemoclaw $SANDBOX agent -m ...`; the core doesn't depend on the channel. |
| R13 | crash or restart mid-workflow | `python3 -m app status` (what's stuck), then `python3 -m app recover` (verifies interrupted executions, never re-executes). Re-running execute is safe because it's idempotent. |
| R14 | primary model unusable | `bash scripts/switch_model.sh <alt-profile> <current-profile>`. It probes and rolls back automatically; minutes of downtime. See docs/RESILIENCE.md §2. |
| R15 | DB corrupt or needs a checkpoint | `python3 -m app db backup` before every gate (cheap). Restore is **offline only**: stop `serve` AND `ui`, `python3 -m app db restore <file>` (it refuses while either still listens, even if broken; it also refuses when it cannot check `serve` — export `BRIDGE`/`APP_SERVICE_URL`, or add `--services-stopped` once you have stopped it yourself), `status`, start both again, reload the console. |
| R9 | `status: in_flight` in the agent JSON | A run is already active on that session. Use a new `--session-id`. To clean up: `nemoclaw $SANDBOX exec -- openclaw sessions delete "<key>" --yes`. |

## 3. Network decision tree (sandbox → host service)

First, read the client's error code: `nemoclaw $SANDBOX exec -- python3 <skill dir>/client.py read_records '{}'`. Then watch for denials with `openshell logs $SANDBOX --tail --source sandbox` (or `openshell term`).

| # | symptom | likely cause | check | fix (no insecure workarounds) |
|---|---|---|---|---|
| D1 | `service_unreachable` with "Name or service not known" | DNS: `host.openshell.internal` doesn't resolve | `nemoclaw $SANDBOX exec -- getent hosts host.openshell.internal` | Check `openshell --version` is 0.0.116. Re-run onboard. Ask NVIDIA staff. **Do not** switch to an IP literal; presets refuse it. |
| D2 | a proxy 403, or an OCSF `DENIED … policy:-` line | proxy policy denial: no matching endpoint+binary entry | `nemoclaw $SANDBOX policy list` shows host-tools? Is the denied binary path `/usr/bin/python3`? | Re-apply after `--dry-run`. If the log names another python path, set **that exact path** in `binaries`. |
| D3 | a denial mentioning private, SSRF or `allowed_ips` | the resolved IP isn't in `allowed_ips` | compare the `getent` IP with `$BRIDGE` | Re-generate with the IP that `getent` shows (/32). If NemoClaw rejects /32, use the documented RFC1918 fallback **on this endpoint only**. |
| D4 | `request_authority_mismatch` | the Host header is missing the port | — | The client uses urllib, which sends `Host: host.openshell.internal:8765`. Check `client.json`'s `remote` has `:8765`. |
| D5 | `service_unreachable` with "Connection refused" | nothing is listening on that IP:port | on the host, `ss -ltnp \| grep 8765` | Restart `serve --bind $BRIDGE`. The client retries a refused connection 3 times (1+2+4 s). |
| D6 | `service_unreachable` with "timed out" or "unreachable" | a firewall, or the wrong bridge | `sudo iptables -S \| grep 8765` (read-only) | Use the bridge of the network the sandbox is on (`docker network inspect`). Ask before any firewall change. |
| D7 | `unauthorized` | token mismatch | `client.json` token vs `data/.agent_token` | Rebuild the package after the service has created its token, then reinstall. |
| D8 | `unknown_tool` for an agent tool | `APP_AGENT_TOOLS` doesn't list it | the `serve` startup line `enabled_tools` | Restart with the full list. **Never** add `decide_approval`; the service refuses it anyway. |
| D9 | `bad_response` | something other than our service answered (a proxy page, or the wrong port) | `curl -s -X POST http://$BRIDGE:8765/call` on the host should give 401 JSON | Fix the URL or port in `client.json`. |
| D10 | a schema mismatch (`invalid_input`, or the bench WARNING) | tool args or the CLI JSON differ | run the failing call from the client; check `results/gate2/captured_agent.json` | Tool args: fix the SKILL.md text. CLI JSON: Gate 2 contract fix. |

## 4. First hour (exact sequence)

| minute | action | gate |
|---|---|---|
| 0–5 | `uname -m; nvidia-smi; docker info \| head; nemoclaw --version; df -h ~` to see what's preinstalled | — |
| 5–20 | verify and restore the USB stage, clone the bundle, `gate0` | 0 |
| 20–50 | NemoClaw onboard (or check the existing install), find the API key, warm up, `gate1` | 1 |
| 50–60 | start `serve` on the bridge, policy `--dry-run` then apply, package and install, `gate2` | 2 |

**Teammate, in parallel:** create `results/HINTS.md` and `results/CHANGES_ON_SITE.md`, start the screen recording (DEMO_GUIDE.md), and keep timestamps.

## 5. Status: verified vs not

| verified (where) | not verified (needs the GB10) |
|---|---|
| Full test suite on Windows; contract, service and bake-off suites are new this round. Counts are in the readiness report. | NemoClaw install/onboard on the Dell; model load time; TTFT and throughput |
| Docker runner flags/limits on linux/amd64; cgroup memory kill with the arm64 image (QEMU) | Docker runner under the GB10's cgroup setup (Gate 0) |
| Offline restore in an arm64 container with no network: checksums, wheels, bundle, 39 tests passed | `RLIMIT_AS` on real ARM64 (failed under QEMU) |
| Preflight Gate 1 against a fake bearer-auth vLLM; gates 3–5 refuse mock and fixture evidence | `/metrics` on the nvcr 0.21.0 build (key location now from NemoClaw source) |
| `parse_agent_json` against fixtures shaped from the openclaw 2026.9.2 **source** | real `openclaw agent --json` output (Gate 2 captures it) |
| preset field names from OpenShell 0.0.116 docs | that `host-tools.yaml` with `/32` passes `--dry-run`; that `host.openshell.internal` resolves to the bridge we bind |
