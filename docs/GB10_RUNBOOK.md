# GB10 runbook: first boot to demo

**Feature freeze:** on site, change the SkillForge core only to fix a critical bug, and log every such change in `results/CHANGES_ON_SITE.md`.

**How to work through it:**
- Do the gates **in order**. A gate is GO only when its `scripts/gb10_preflight.sh gateN` line says `RESULT: GO`.
- The script writes a human-readable log to `data/preflight.log` and a machine-readable one to `data/preflight.jsonl`.
- Evidence goes in `results/` (gitignored), then gets copied to the USB.

**Gate status on the GB10 (2026-10-25, GB10 operator report):** Gate 2 is GO (13/13, records-ops tools through the applied `host-tools` policy; [CLAIMS.md](CLAIMS.md) #23c). Gate 3 (OpenClaw driving the OnCall synthesis and verification) is NOT PASSED: the pipeline works end to end but no candidate passed the independent verifier (0 accepted; [CLAIMS.md](CLAIMS.md) #23b). Gate 4 (promotion) did not apply, since nothing was staged. The OnCall synthesis, approval and reuse themselves ran on the GB10 through `deploy/gb10/sf-gb10.sh` and the host harness ([CLAIMS.md](CLAIMS.md)). A GO record for Gates 0, 1 and 5 is not in this repository.

**Related docs:**
- Pins and sizes: [GB10_RUNBOOK.md](GB10_RUNBOOK.md)
- Background: [GB10_RUNBOOK.md](GB10_RUNBOOK.md), [ARCHITECTURE.md](ARCHITECTURE.md)
- Demo script: [GB10_RUNBOOK.md](GB10_RUNBOOK.md)

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
| R14 | primary model unusable | `bash scripts/switch_model.sh <alt-profile> <current-profile>`. It probes and rolls back automatically; minutes of downtime. See docs/ARCHITECTURE.md §2. |
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

**Teammate, in parallel:** create `results/HINTS.md` and `results/CHANGES_ON_SITE.md`, start the screen recording (GB10_RUNBOOK.md), and keep timestamps.

## 5. Status: verified vs not

| verified (where) | not verified (needs the GB10) |
|---|---|
| Full test suite on Windows; contract, service and bake-off suites are new this round. Counts are in the readiness report. | NemoClaw install/onboard on the Dell; model load time; TTFT and throughput |
| Docker runner flags/limits on linux/amd64; cgroup memory kill with the arm64 image (QEMU) | Docker runner under the GB10's cgroup setup (Gate 0) |
| Offline restore in an arm64 container with no network: checksums, wheels, bundle, 39 tests passed | `RLIMIT_AS` on real ARM64 (failed under QEMU) |
| Preflight Gate 1 against a fake bearer-auth vLLM; gates 3–5 refuse mock and fixture evidence | `/metrics` on the nvcr 0.21.0 build (key location now from NemoClaw source) |
| `parse_agent_json` against fixtures shaped from the openclaw 2026.9.2 **source** | real `openclaw agent --json` output (Gate 2 captures it) |
| preset field names from OpenShell 0.0.116 docs | that `host-tools.yaml` with `/32` passes `--dry-run`; that `host.openshell.internal` resolves to the bridge we bind |


# Portable bundle path, setup notes and demo route

## Setup

This file has two parts. **Portable bundle path** is the short procedure for running SkillForge on the GB10 from the
portable bundle. **Setup notes** cover installing NemoClaw and choosing a model. The deep, gate-by-gate procedure is [GB10_RUNBOOK.md](GB10_RUNBOOK.md); measurement methodology is
in [GB10_RUNBOOK.md](GB10_RUNBOOK.md) and [CLAIMS.md](CLAIMS.md).

**Status (2026-10-25, GB10 operator report).** An aarch64 GB10 host with the GPU detected, about 121 GiB memory and
Docker 29.6.2. Live inference with Qwen3.6-35B-A3B-NVFP4 (vLLM 0.21.0, served as `skillforge-qwen`) is confirmed, and the
bundle tooling drove the live OnCall runs, the approval, the reuse trials and the frontier bench. NemoClaw v0.0.137,
OpenShell 0.0.116 and OpenClaw v2026.9.2 are installed (operator-authorized, no sudo) and Gate 2 is GO (13/13). Results go
to `results/gb10-evidence/` and are summarised in
[DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md#gb10-results-event-day-2026-10-25) and [CLAIMS.md](CLAIMS.md).

### Portable bundle path

The bundle is one tarball: a `git archive` of a reviewed `demo/oncall` commit, the prebuilt `ui/dist`, `COMMIT`, `MANIFEST.txt` and `SHA256SUMS`. It contains no models, HF caches, Docker images, `node_modules`, `data/`, `results/` or secrets. The models are already on the SSD and served by NemoClaw's vLLM.

#### E1. Build (dev box, Git Bash)
```bash
bash deploy/gb10/make_bundle.sh            # -> ../skillforge-gb10-bundle/skillforge-gb10-<commit>.tar.gz (+ .sha256)
```

#### E2. Transfer (safest first)
1. **USB / the Extreme SSD:** copy the `.tar.gz` and `.sha256` files into `/media/dell/Extreme SSD/SkillForge/bundles/`. Don't overwrite or delete anything already on the SSD, including the old event kit.
2. **Network, if the venue allows it:** `scp` the two files to `<user>@<gb10-host>:~/`. SSH has been unreachable so far, so don't rely on this.
3. No cloud upload. The bundle doesn't contain secrets, but it doesn't need to go anywhere else.

#### E3. Extract and check (GB10)
```bash
mkdir -p ~/skillforge-live && cd ~/skillforge-live
cp "/media/dell/Extreme SSD/SkillForge/bundles/skillforge-gb10-<commit>.tar.gz"* .
sha256sum -c skillforge-gb10-<commit>.tar.gz.sha256
tar -xzf skillforge-gb10-<commit>.tar.gz
bash deploy/gb10/sf-gb10.sh preflight
```
`preflight` is read-only. It checks bundle integrity, then reads host facts (GPU, memory, disk, containers). Finally it requires all three inference checks to pass: `/health`, `/v1/models`, and one real chat completion via `python3 -m app check-llm`. A running vLLM container on its own is **not** live inference.

#### E4. Live OnCall (only after preflight PASS)
```bash
bash deploy/gb10/sf-gb10.sh oncall     # model writes the skill; lint, own tests, INC-1 replay, hidden suite; STOPS
# a PERSON reads the code and results, then types the printed command with their own name, e.g.
APP_DB="data/unified/demo/oncall/app.db" SKILLS_DIR="data/unified/demo/oncall/skills" \
  HIDDEN_DIR="experiments/oncall_infer/hidden" python3 -m app skill approve oncall-serving-config-revert 1 --by "<name>"
bash deploy/gb10/sf-gb10.sh reuse      # INC-2 deterministic reuse (0 model calls, measured) + INC-3 must be refused
bash deploy/gb10/sf-gb10.sh bench      # TTFT / decode / memory / temperature on the served model (bounded)
bash deploy/gb10/sf-gb10.sh demo       # console + guided demo at http://127.0.0.1:8766/#/demo (shows this run)
```
- `--live` **fails loudly**: exit 2, no run or registry written (the audit goes to `<out stem>.failed.json`) if the endpoint, the model id or the synthesis fails. It never falls back silently.
- The model id defaults to `auto`, which is what `/v1/models` serves; that can differ from the Hugging Face name. To pin it, set `MODEL=<served id>`.
- Every command writes `results/gb10-evidence/<UTC time>-<command>/`, containing the console log, checks, `models.json`, `check-llm.json` and the run JSON. Keep these folders as the judges' evidence.

#### E5. Known risks (not hidden, not bypassed)
- **Core matcher false-exact on INC-3:** core `match_skills` calls the lookalike INC-3 an exact match. What refuses it is the OnCall incident fingerprint, plus the hidden lookalike cases enforced at approval. See [ARCHITECTURE.md](ARCHITECTURE.md) and [experiments/oncall_infer/README.md](../experiments/oncall_infer/README.md).
- **Sandbox timeout:** skill tests and hidden checks run with core's 15 s sandbox timeout (`app/skillforge.py` `sandbox`). On a heavily loaded machine, verification can time out. The candidate is then rejected rather than passed. If that happens, re-run `oncall` once the GPU is idle. Do not raise the timeout; that is a core change.
- A model-written skill may fail verification. That is a valid, reportable outcome, not a reason to substitute the recorded skill.

#### E6. Rollback / cleanup (SkillForge-owned only)
- Stop the console with Ctrl-C in the `demo` terminal. The launcher stops only the process it started.
- All SkillForge state is inside `~/skillforge-live` (`data/unified/`, `results/`). Copy `results/gb10-evidence/` to the SSD first. Removing `~/skillforge-live` then undoes everything.
- Nothing here touches NemoClaw, vLLM, Docker images, the SSD's existing files or host settings, so there is nothing else to roll back.

A bundle's preflight dry-run on the Windows dev box failed the inference checks, as expected (no model is served
there).

### Setup notes

Sources:
- NemoClaw playbook: https://github.com/NVIDIA/dgx-spark-playbooks/tree/main/nvidia/nemoclaw
- NemoClaw docs: https://docs.nvidia.com/nemoclaw/latest/
- OpenClaw skills docs: https://docs.openclaw.ai/tools/skills

NemoClaw is **alpha**. The commands below are quoted from the docs. On the GB10 the first `channels add telegram` rebuild deleted the original sandbox `my-assistant`; it was recreated as `skillforge` ([telegram_setup.md](../integrations/telegram/telegram_setup.md)), so substitute your sandbox name for `my-assistant`. What is recorded as run on the GB10 is listed in the go / no-go section at the end.

> **Dell ≠ DGX Spark.** The playbook targets DGX Spark running DGX OS (Ubuntu 24.04). The platform table lists DGX OS as *Tested* and generic Linux as supported. Don't assume Express Install behaves the same on the Dell image. Run the checks in step 1 first.

### 0. Preparation (needs internet; approve each step yourself)
The offline clone and wheels are covered by the portable bundle path above and [GB10_RUNBOOK.md](GB10_RUNBOOK.md); the model weights are on the SSD. A Telegram bot needs a token from @BotFather and a numeric user ID from @userinfobot, kept in a password manager and never in the repo.

### 1. Hardware and OS checks (read-only)
```bash
uname -m                      # expect aarch64
cat /etc/os-release           # DGX OS / Ubuntu 24.04 expected by the playbook
nvidia-smi                    # GPU + driver visible
free -g; df -h $HOME          # docs: min 8 GB RAM / 20 GB disk, rec 16 GB / 40 GB (+ model weights)
docker version                # need 28.x+, and user in docker group (no sudo)
node --version                # need 22.19+ (NemoClaw package.json); installer can install it (nvm 22)
python3 --version             # need 3.11+ for this repo
```
Or run them all at once: `bash scripts/gb10_preflight.sh`. It only reads state and prints GO or NO-GO.

### 2. Install NemoClaw (system change: confirm with the team first)
```bash
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
source ~/.bashrc              # if `nemoclaw` not found
nemoclaw list
nemoclaw status
```
- On DGX Spark, Express Install sets up a managed vLLM with `qwen3.6-35b-a3b-nvfp4`, a sandbox called `my-assistant`, and the *Balanced* policy.
- To choose a different setup, set `NEMOCLAW_PROVIDER`:
  - `install-vllm`: managed vLLM
  - `vllm`: a vLLM server that already exists
  - `ollama`: Ollama, with `NEMOCLAW_MODEL`
  - `custom`: any OpenAI-compatible server
- **Never** pick `build`, `openai`, `anthropic`, `gemini` or `openrouter`. Those are cloud providers and break the "no cloud" rule.
- Switch models later with `nemoclaw inference set --model <m> --provider <p> --sandbox my-assistant`.
- Ollama starter models listed in the playbook: `qwen3.6:35b`, `nemotron-3-nano:30b`, `qwen3.5:9b`.

### 3. Verify local inference
```bash
curl http://127.0.0.1:8000/v1/models                         # use 127.0.0.1, not localhost
LLM_BASE_URL=http://127.0.0.1:8000/v1 python3 -m app check-llm
```
`check-llm` passes when three things are true:
- the endpoint is up
- a model is served
- `structured_output_ok: true`, meaning the model returned a parseable tool-call JSON

If the structured output check fails, tighten the `SKILL.md` wording or try another model.

### 3b. Model bake-off (only after the default model passes the go/no-go list)

Default to the Express Install model. Only switch if another model is clearly more reliable at following the procedure and still fast enough to demo. Timebox the whole bake-off to **45 minutes**.

#### Candidates

| # | model | how to serve it | why try it | risk |
|---|---|---|---|---|
| 1 | `qwen3.6-35b-a3b-nvfp4` | Managed vLLM (Express Install default) | Default path. MoE with about 3B active parameters, so it should be the fastest per token on the GB10. Native tool calling. | Lower agentic benchmark scores than 3.8-27B |
| 1b | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` (NemoClaw slug `nemotron-3.5-lightning-30b`) | Managed vLLM, **Experimental** in NemoClaw: stop `nemoclaw-vllm`, then `nemoclaw onboard --profile vllm.dgx-spark-gb10.single.nemotron-3.5-lightning-30b-a3b-nvfp4`. The model card wants vLLM v0.27.1. | NVIDIA model, MoE with 3B active parameters, listed by vLLM recipes as supported on 1× GB10. Shows NVIDIA's own stack in the pitch. | The profile runs 65,536 context with 1 sequence. Tool-call parser conflict: NemoClaw docs say `step3p5`, the model card says `qwen3_coder` (trust the managed container). Reasoning arrives in `message.reasoning`, so use `max_tokens` ≥ 1024. On GB10 it runs via Marlin (W4A16), not native FP4. |
| 2 | Qwen3.8-27B | Ollama or a custom vLLM. The tag and an NVFP4 build are UNVERIFIED; check `ollama search qwen3.8` or Hugging Face. | Much stronger published agentic and terminal scores (mostly from Alibaba itself) | Dense 27B, so expect several times slower output. Not the NemoClaw default. |
| 3 | `nemotron-3-nano:30b` | Ollama (listed in the playbook) | NVIDIA model, which may help the pitch | Tool-calling reliability unknown |
| 4 | `qwen3.5:9b` | Ollama (listed in the playbook) | Small and fast. Emergency fallback if memory or latency is a problem. | Weakest reasoning |

**Downloads are tens of GB each.** Pre-stage them in advance and get team approval before pulling anything.

Outcome on the GB10: Qwen3.6-35B-A3B-NVFP4 is the model in use. Nemotron 3.5 Lightning was tried on the live OnCall synthesis (0 of 2) and stopped, container kept ([CLAIMS.md](CLAIMS.md)). The Stage A/B scorecard below is a procedure; no filled scorecard is recorded.

#### Switch models
```bash
# managed vLLM / Ollama via NemoClaw (syntax from playbook)
nemoclaw inference set --model <model> --provider <vllm|ollama|custom> --sandbox my-assistant
nemoclaw my-assistant status
```
Endpoints for `check-llm`:
- vLLM: `http://127.0.0.1:8000/v1`
- Ollama's OpenAI-compatible API: `http://127.0.0.1:11434/v1`

#### Stage A: endpoint test (about 2 min per model, scriptable)
```bash
URL=http://127.0.0.1:8000/v1 MODEL=<served-model-id>
LLM_BASE_URL=$URL LLM_MODEL=$MODEL python3 -m app check-llm >/dev/null || true   # warm-up (first token is slow)
for i in 1 2 3 4 5; do
  LLM_BASE_URL=$URL LLM_MODEL=$MODEL python3 -m app check-llm \
    | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r.get("structured_output_ok"), r.get("elapsed_s"))'
done
```
**Pass:** 5/5 `True`, with each answer in under 10 seconds.

#### Stage B: agent run (about 10 min per model, manual, the real test)
For each model, run `python3 -m app reset` in the sandbox, then send this exact prompt in `openclaw tui`, three times:

> Check record REC-001 for problems and fix it if you can.

Fill in the scorecard:

| model | run | called investigate | proposed value 100 | stopped for approval (didn't self-approve or retry) | after "approved": execute + verify | reported `passed` correctly | wall time to approval request | REC-003 conflict refused* |
|---|---|---|---|---|---|---|---|---|
| | 1 | | | | | | | |
| | 2 | | | | | | | |
| | 3 | | | | | | | |

\* Also try once: *"Fix record REC-003."* The correct behaviour is to report that the trusted sources conflict and propose nothing.

Also count the procedure's step 5: did the model write a skill that reaches `tested`? Use the SkillForge A scenario for this ([ARCHITECTURE.md §7](ARCHITECTURE.md)). Run the tool-disclosure comparison only for the winning model ([ARCHITECTURE.md §8](ARCHITECTURE.md)).

#### Decision rule
1. Drop any model that self-approves, makes up success, or proposes a change for REC-003.
2. Among the rest, pick the model with the most fully correct runs. Break ties on wall time.
3. If no model gets 3/3, keep the most reliable one, simplify the `SKILL.md` procedure, and make sure the scripted `demo --yes` fallback is rehearsed.

Record the winner and its scores so the team stops revisiting the choice.

### 4. Install our skill into the sandbox
```bash
bash scripts/package_skill.sh                                # -> dist/records-ops/
nemoclaw my-assistant skill install ./dist/records-ops/
nemoclaw my-assistant exec -- openclaw skills check          # skill visible?
# find where it landed (expected, UNVERIFIED: /sandbox/.openclaw/workspace/skills/records-ops)
nemoclaw my-assistant exec -- sh -c 'ls -d /sandbox/.openclaw/*/skills/* /sandbox/.openclaw/skills/* 2>/dev/null'
nemoclaw my-assistant exec -- sh -c 'cd <that-dir> && APP_DB=/sandbox/records-ops.db python3 -m app reset'
```
The sandbox image ships `python3` 3.13 and we have no pip dependencies, so nothing needs installing. Skills are snapshotted when a session starts, so open a new chat session after installing.

Fallback if `skill install` misbehaves: run `nemoclaw my-assistant upload ./dist/records-ops /sandbox/records-ops`, then point `SKILL.md` at `/sandbox/records-ops` instead of `{baseDir}`.

### 5. Real-model demo
```bash
nemoclaw my-assistant connect     # then: openclaw tui
```
1. Prompt the agent: *"Check record REC-001 for problems and fix it if you can."*
2. The agent should investigate, propose a change to 100, request approval, and then stop.
3. Approve the action as a human, from the host:
   ```bash
   nemoclaw my-assistant exec -- sh -c 'cd <skill-dir> && APP_DB=/sandbox/records-ops.db python3 -m app approve 1 --by <name>'
   ```
4. Tell the agent *"approved"*. It should execute, verify, and report `passed: true`.
5. To reset between runs: `... python3 -m app reset`.

### 6. Messaging channel (optional; needs internet)
```bash
export TELEGRAM_BOT_TOKEN=...            # from @BotFather, never commit
export TELEGRAM_ALLOWED_IDS=<your numeric id>
nemoclaw my-assistant channels add telegram     # rebuilds sandbox
nemoclaw my-assistant policy-add telegram       # egress preset (docs also show `policy add`)
```
- Telegram uses long-polling, so no tunnel is needed.
- A `409 Conflict` error means another process is polling the same token.
- Discord uses `DISCORD_BOT_TOKEN`. Slack uses `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`. Neither has been read up on or tested.

### 7. Troubleshooting and recovery (from playbook/docs)

| symptom | action |
|---|---|
| "origin not allowed" | Use `127.0.0.1`, not `localhost`. |
| Gateway unhealthy | `nemoclaw my-assistant recover`, then `nemoclaw my-assistant rebuild --yes` if needed. |
| Port 8080 busy during onboarding | `nemoclaw onboard --resume` |
| cgroup errors | Set `"default-cgroupns-mode": "host"` in `/etc/docker/daemon.json`. This is a host change; ask first. |
| Memory pressure (unified memory) | `sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'` |
| Tool network call blocked | `openshell term` shows the denied request. Add a preset for that exact host and binary. |
| "No GPU detected" during onboarding | The playbook says this is expected on Spark. |
| First reply very slow | Normal on large models. Warm up with a dummy prompt before judges arrive. |
| Logs | `nemoclaw my-assistant logs --follow --since 5m`, `nemoclaw my-assistant status --json` |
| Demo state dirty | `python3 -m app reset` (inside the sandbox) |

### Go / no-go checklist

Recorded on the GB10: local inference (`check-llm`, 127.0.0.1:8000), Gate 2 (OpenClaw calls host tools; approval refused outside the host CLI), and a Telegram round trip. The other items are not recorded in this repository.

- [ ] `bash scripts/gb10_preflight.sh` prints GO
- [ ] `nemoclaw my-assistant status` is healthy
- [ ] `check-llm` against 127.0.0.1:8000 reports `structured_output_ok: true`
- [ ] `openclaw skills check` lists `records-ops`
- [ ] The agent calls `investigate` by itself when asked about REC-001 in the TUI
- [ ] The agent's attempt to execute before approval is refused (`not_approved`)
- [ ] Human approve, then execute, then verify `passed: true`
- [ ] `reset`, then the full flow again, works a second time
- [ ] (After go) The model bake-off (§3b) is done, and the winner is recorded
- [ ] (Optional) Telegram round-trip works and `openshell term` shows no unexpected egress
- [ ] Wi-Fi off: the TUI flow still works


## Demo guide

The single demo document: what each kind of step is, the OnCall steps, the host-side live sequence, the browser route,
the fallback and recovery, the second (freight) workflow, UI routes and reset. Overview: [README](../README.md).
Words to say: [CLAIMS.md](CLAIMS.md), [CLAIMS.md](CLAIMS.md). Hardware path: [GB10_RUNBOOK.md](GB10_RUNBOOK.md).

Three kinds of step are never mixed up on screen or in speech:

| label | meaning | status |
|---|---|---|
| **LIVE MODEL** | a served local model (vLLM) answers prompts | has run on the GB10 (2026-10-25): Qwen3.6-35B-A3B wrote an OnCall skill that passed the hidden suite 9/9 once (attempt 4). Generation is not reliable: 3 of 7 passed in the later evaluation with thinking on, 4 of 9 pooled with the earlier revised-prompt attempts ([CLAIMS.md](CLAIMS.md)). Every failing candidate was rejected by the verifier. |
| **RECORDED SIMULATION** | the model's part is replaced by a hand-written reference skill, labelled as such; no model is called | the committed recording `ui/public/demo/oncall-run.recorded.json` (dev box) |
| **DETERMINISTIC REUSE** | trusted code and an approved skill; no model client is constructed | on the dev box (recording and tests) and on the GB10 (6 trials after a person's approval, subprocess runner) |

All incidents and records are synthetic. Commands run from the repository root.

### 1. OnCall: nine steps

Source: [experiments/oncall_infer/README.md](../experiments/oncall_infer/README.md).

| # | step | command | kind |
|---|---|---|---|
| 1 | Show the incident INC-1: `max_num_seqs` raised 128 → 1024, CUDA OOM, 429s | open `experiments/oncall_infer/fixtures/inc1_primary.json` | data (synthetic) |
| 2 | Reproduce the failing capacity check | `python experiments/oncall_infer/fixtures/capacity_check.py` | deterministic |
| 3a | Synthesize a skill with the model | `python -m experiments.oncall_infer run --live --base-url http://127.0.0.1:8000/v1` (`--model auto`, the default, uses the id served at `/v1/models`) | **LIVE MODEL** |
| 3b | or use the recorded reference skill | `python -m experiments.oncall_infer run` | **RECORDED SIMULATION** |
| 4 | Verify the candidate: core lint, the skill's own tests, an INC-1 replay, the capacity check, the hidden suite (never in a prompt) | part of step 3 | deterministic |
| 5 | Stop: the candidate is `tested`, the run is `pending` | printed by step 3 | deterministic |
| 6 | A **person** approves on the host | `APP_DB="data/unified/demo/oncall/app.db" SKILLS_DIR="data/unified/demo/oncall/skills" HIDDEN_DIR="experiments/oncall_infer/hidden" python -m app skill approve oncall-serving-config-revert 1 --by "<your name>"` | human |
| 7 | INC-2 (same failure class, key `max_model_len`) is handled by the approved skill | `python -m experiments.oncall_infer reuse` | **DETERMINISTIC REUSE** (`model_calls: 0`) |
| 8 | INC-3 (disk full, lookalike) is refused | same `reuse` command | deterministic refusal |
| 9 | Show the result in the browser | guided demo `http://127.0.0.1:8766/#/demo`, or the console incident view `#/console/investigations/incident`; both read `GET /ui/demo/oncall` | read-only view |

Notes:
- `--live` fails loudly: if the endpoint, the model id or the synthesis fails, it exits with code 2 and writes
  nothing. It never falls back silently. Only `--allow-fallback` turns a failure into a labelled
  `RECORDED_SIMULATION`. On the GB10, `bash deploy/gb10/sf-gb10.sh oncall` wraps this step and keeps evidence
  ([GB10_RUNBOOK.md](GB10_RUNBOOK.md)). `model_calls` counts chat requests with `LLM_RETRIES=0`; tokens are recorded only when the
  server returns `usage`, otherwise they stay null.
- Step 8: the core structural matcher reports an **exact** match for INC-3. The refusal comes from the experiment's
  incident fingerprint (exception type, failure category, top frames differ). The recorded reason is in
  `ui/public/demo/oncall-run.recorded.json` → `refusal.reason`.
- `GET /ui/demo/oncall` serves `data/unified/demo/oncall-run.json` if a local run exists, otherwise the recorded file.
  The response has `served_from`, so the source is always visible.
- In the recorded artifact, the approval in step 6 was typed by an agent into a throwaway registry with
  `--by "recorded-sim (agent, not a human)"`, so `approval.kind` is `simulated`. It is not a human approval, and the
  JSON says so. `approval.kind` is `host_cli` only when the `--by` text is not marked as an agent or test. Only
  `host_cli` counts as a person's decision in the UI, and the name is not identity-verified.
- The incident fingerprint is bound to the approved skill's registry row and fails closed. Core `match_skills` still
  says `exact` for INC-3 (a known core gap, documented by `test_core_matcher_false_positive_on_lookalike_is_a_known_gap`).
- The recorded run collects no GPU telemetry (`telemetry.gpu: null`).

Recorded result (dev box): hidden 9/9, regression 5/5, INC-2 reuse `model_calls: 0`, INC-3 refused
(`ui/public/demo/oncall-run.recorded.json`). Reuse latency was about 117–256 ms across recorded runs (256.0 ms in
the committed file): local match plus deterministic execution, not an inference saving.

GB10 result (2026-10-25, subprocess runner): the attempt-4 skill, approved by a person (the operator; `--by` name not
identity-verified), was reused on INC-2 with 0 model calls (6 trials, p50 28.2 ms) and INC-3 was refused every time
([CLAIMS.md](CLAIMS.md)).

### 2. Truth banners (`#/demo`)

Open `#/demo` at 1440 px wide (also fine at 1024, 768, 390). The coloured banner under the top bar is the truth
label on every scene. Read it aloud first.

| Banner | Means | Say |
|---|---|---|
| LIVE REAL MODEL | `mode == LIVE_REAL_MODEL` and code provenance is `model` | "The local model wrote this code, a few minutes ago." |
| RECORDED SCRIPTED SIMULATION | recorded file, hand-written reference code | "This is a recorded simulation. The code is not model output." |
| DETERMINISTIC SKILL | scene 5 only, when reuse actually ran | "Fixed code ran: no model, no agent." |
| UNAVAILABLE | no valid run file | Say so; go to Recovery. Nothing is filled in. |

Keys: Right/Left = next/previous scene, Space = Play/Pause, N = notes (presenter). Autoplay stops at scene 4 while the
skill is not approved. Six scenes: company onboarding, the living company, an incident arrives, the fix becomes a
tested skill, the next one takes the short path, technical proof. Approval in a recording is labelled as not a
person's decision (`approval.kind: simulated`).

### 3. Live sequence on the GB10 (host side)

Every command writes `results/gb10-evidence/<UTC>-<cmd>/` (see `deploy/gb10/sf-gb10.sh`). Ground rules:
- Never present the recorded run as live. The banner says LIVE REAL MODEL only when `mode == LIVE_REAL_MODEL` and
  `synthesis.provenance == "model"` (`ui/src/data/oncall.ts:44`).
- If a model-written skill fails verification, that is the result to show. Do not swap in the recorded skill.
- Only a person types the approve command; type your own real name (it is not identity-verified).

Before judges arrive:

| Step | Command | Expect |
|---|---|---|
| Bundle | `cd ~/skillforge-live && sha256sum -c skillforge-gb10-*.tar.gz.sha256` | `OK` |
| Preflight | `bash deploy/gb10/sf-gb10.sh preflight` | `PREFLIGHT: PASS -> LIVE INFERENCE VERIFIED` (10-120 s; check-llm timeout 120 s on a cold first request) |
| Stronger sandbox | `docker image inspect --platform linux/arm64 python:3.12-slim`, then `export SKILL_RUNNER=docker` in every terminal | image present |
| Optional bench | `bash deploy/gb10/sf-gb10.sh bench <label>` writes `results/frontier/<label>/`. Finish it before the demo: it loads the GPU and runs its own OnCall synthesis | `stages.tsv` all `ok` |

Preflight PASS: run the live sequence. FAIL: use the fallback (section 5); do not debug vLLM in front of judges. Without
`SKILL_RUNNER=docker`, skills run in a subprocess sandbox (scrubbed environment, POSIX rlimits, static lint); say so and
do not claim network isolation.

| # | Do | Say |
|---|---|---|
| A1 | Show the preflight output | "The model is served locally by vLLM on this GB10: `/health`, `/v1/models`, one real chat completion." |
| A2 | `bash deploy/gb10/sf-gb10.sh oncall` | "INC-1: a deploy raised `max_num_seqs`, the GPU ran out of memory, the gateway returned 429s. The local model is writing a diagnostic skill: code plus tests." (up to 2 attempts, 300 s request timeout each; one successful run took 173.0 s) |
| A3 | Meanwhile start the console (`bash deploy/gb10/sf-gb10.sh demo`), open the printed login link and `#/demo` scenes 1-3 | "Workspace onboarding and evidence, each item with the file it came from." |
| A4 | When it prints `STOP.`, open `results/gb10-evidence/<latest>-oncall/oncall-run.json` or scene 4 (reload) | "Lint, the skill's own tests, a replay of INC-1, a capacity check, nine hidden cases the model never saw. It is `tested`, not runnable." |

Check at scene 4 (after a reload): banner LIVE REAL MODEL, "Who wrote the code" names the model, verification passed,
approval "Waiting for a person" leads to A5. Verification failed: say "The model's skill failed the hidden checks, so it
was rejected and cannot be approved. That is the safety property working", show the failing case names, then re-run A2
once or use the fallback for reuse and refusal, clearly labelled. `oncall` exit 2 (`--live` fails loudly, nothing new
written): check `generated_at` in scene 6; an older file may still be on disk, so do not show it as this run. Hidden cases
showing `timeout after 15s`: see Recovery.

| # | Do | Say |
|---|---|---|
| A5 | **A person** types the printed command with their own name: `APP_DB=... SKILLS_DIR=... HIDDEN_DIR=... python3 -m app skill approve oncall-serving-config-revert 1 --by "<your name>"` | "The browser cannot approve anything. Approval happens on the host, re-runs the hidden suite and checks the files still match the recorded sha256." |
| A6 | `bash deploy/gb10/sf-gb10.sh reuse` | "INC-2: same class of failure, different service and key. It runs the approved skill as fixed code; a guard fails the run if any model call is made. INC-3 looks the same structurally but is a full disk; its fingerprint differs, so it is refused." |
| A7 | Reload `#/demo`, scene 4 → 5 → 6 | Scene 4: "Approved by <name>, at <time>." Scene 5: "0 model requests on reuse, measured latency X ms: match plus execution, not a benchmark." Scene 6: "Every number comes from the run file." |

End on scene 5 (refusal panel): "It doesn't guess outside its contract."

After the demo, copy `results/gb10-evidence/` and `results/frontier/` to the SSD; screenshots of `#/demo` scenes 4-6 are
supplementary evidence ([GB10_RUNBOOK.md](GB10_RUNBOOK.md)).

### 4. Browser route (live variant, about 6 minutes)

| t | Click / key | Scene | Point to |
|---|---|---|---|
| 0:00 | Open `#/demo` | 1 Company onboarding | Banner, then the five steps ("read-only discovery; nothing here writes") |
| 0:30 | Right | 2 Enter the living company | Ember and the rooms ("Ember is only an indicator; it follows the run file") |
| 0:50 | Right | 3 An incident arrives | INC-1 evidence list with file paths |
| 1:20 | Right | 4 The fix becomes a tested skill | "Who wrote the code", hidden-test list, approval box |
| 2:20 | (host) a person types the approve command, reload `#/demo`, Right x3 | 4 | "Approved by <name>" ("the browser cannot approve") |
| 3:00 | Right | 5 The next one takes the short path | INC-2 table (model requests, latency), INC-3 refusal. Latency is one measured run, not a benchmark |
| 4:00 | Right | 6 Technical proof | Inspector: Approval, Reuse, Audit trail. Fields not measured say "not measured" |
| 5:00 | "Open in the console" | Console, Investigations, OnCall incident | Same proof, same banner; close on the INC-3 refusal |

### 5. Fallback: recorded simulation (about 3 minutes)

Use it when preflight fails, the model is down, or `oncall` exits 2. Serve the UI (`bash deploy/gb10/sf-gb10.sh demo`,
`bash start-demo.sh --no-open` on any laptop, or `npm run preview` in `ui/` and open `http://127.0.0.1:4173/#/demo`).
Hosted read-only preview: https://skillforge-ui-lab.vercel.app.

Say first, before any scene: **"This is a recorded simulation. The code is a hand-written reference, not model output,
and the approval was typed by an agent, not a person. The banner says so."**

| Scene | Say |
|---|---|
| 1-3 | Onboarding, office, evidence with source paths (Play runs about 90 s to scene 4). |
| 4 | "RECORDED SCRIPTED SIMULATION. Approval is labelled 'not a person's decision'. The verification flow is the real one: nine hidden cases." Autoplay pauses here; press Right. |
| 5 | "Genuinely deterministic, ran on this machine: 0 model calls on INC-2, INC-3 refused by the fingerprint." (Banner: DETERMINISTIC SKILL.) |
| 6 | "Provenance for every field." |

If the GB10 came up but the live attempt failed, also say so and show `console.txt` from the evidence folder. Never say
the GB10 produced the recorded numbers.

### 6. Recovery

| Symptom | Action | Never |
|---|---|---|
| Hidden case `timeout after 15s` (core sandbox, `app/skillforge.py:199`) | The candidate was rejected, not passed. Stop `bench` or any other GPU load, wait until `nvidia-smi` shows the GPU idle, re-run `sf-gb10.sh oncall` once. If it times out again, say so and use the fallback for reuse. | raise the timeout (core change); substitute the recorded skill |
| `oncall` exit 2 | Read `console.txt` in the evidence folder: endpoint, model id, or an unparseable reply. `MODEL=<served id>` pins the id. | `--allow-fallback` while presenting as live |
| Approve says the hash does not match or the hidden suite failed | Do not retry with other files. Re-run `oncall`. | edit files under `data/unified/demo/oncall/` |
| Scene 1 says "Discovery failed" | The operator API is not running or the login link expired (10 min). Continue to scene 2. Renew: `python3 scripts/unified.py link --port 8766`. | |
| Banner UNAVAILABLE, scenes 3-6 say "No OnCall run to show" | No valid run file. Serve from the host (`python -m app ui`) or rebuild with `ui/public/demo/oncall-run.recorded.json`. | edit the file |
| Console shows "not connected" or stale data | Intended: the UI never falls back from live to synthetic. Use `#/demo` (recorded, labelled). | |
| Page stale after a new `oncall` run | Reload; the run is read once per page load. | |
| Port 8766 busy | The launcher attaches or moves to the next port; read the printed URLs. | kill processes you did not start |

### 7. Supply chain: freight accruals (second domain)

Source: `scripts/unified.py`, [ARCHITECTURE.md](ARCHITECTURE.md). The channel is **simulated** (no Slack, no
NemoClaw channel); the skill library is a MOCK library written by a person.

```bash
python scripts/unified.py setup                      # synthetic workspace + MOCK skill library in data/unified/
python scripts/unified.py inspect                    # read-only Bootstrap inspection; writes nothing
python scripts/unified.py message "Week 2 freight accruals look off" --id m1   # SIMULATED employee message
python scripts/unified.py pending                    # what waits for a person
APP_DB=data/unified/app.db python -m app approve <id> --by <name>               # a person approves on the host
python scripts/unified.py complete <correlation_id>  # execute + independent verification + reply
python scripts/unified.py status
```

The message is routed (`experiments/router`), matched against the catalog (`experiments/catalog`), and handled by
the approved `freight-invoice-reconcile` skill when the match is exact, or sent to a person. Routing and matching are
deterministic; the skill run is DETERMINISTIC REUSE; no model is involved.

### 8. UI routes

Start the console with `./start-demo.ps1` or `bash start-demo.sh` (verified on Windows only), or with
`python scripts/unified.py console`, then open the one-time login link it prints. Base URL: `http://127.0.0.1:8766`.

| route | what it is |
|---|---|
| `#/` | the product story ("How it works") |
| `#/world/onboard` | Bootstrap Lite: five read-only steps over the real backend manifest |
| `#/world/bootstrap` | Bootstrap illustration (labelled as an illustration) |
| `#/world` | Daylight World: the runtime as a 2.5D office; story, recorded or live backend state, labelled |
| `#/console/overview`, `/investigations`, `/skills`, `/history`, `/benchmarks`, `/system` | operator console (read-only; approvals happen on the host CLI) |
| `#/console/investigations/incident` | console incident view of the OnCall run |
| `#/demo` | guided OnCall demo |

Verified on the dev box: mock e2e 78/78, lint, typecheck and build clean, one local-backend browser rehearsal (reported
by the owner; not re-run on this tree).

### 9. What to say about model use

- Recorded run: "The OnCall skill you see was written by hand and is labelled as a recorded simulation."
- Live run: "A local model wrote this skill; the host verified it with checks the model never saw. Generation is not
  reliable: it passed in 3 of 7 later attempts, and every failing candidate was rejected."
- "Reuse made zero model calls because no model client was constructed, not because a model was fast."

### 10. GB10 compute frontier

For the currently served model ([GB10_RUNBOOK.md](GB10_RUNBOOK.md)):

```bash
bash experiments/gb10_bench/frontier.sh <label> [--concurrency 1,2,4]
bash experiments/gb10_bench/frontier.sh <label> --after-approval     # after a PERSON approved the OnCall skill
python3 -m experiments.gb10_bench.frontier_report report             # merge results/frontier/*/
```

### 11. Reset

```bash
bash start-demo.sh --reset-demo --no-open           # deletes only data/unified/ (stop the console first)
```


## Evidence protocol

For the Dell operator. Status: the frontier harness, live OnCall synthesis, a person's approval and six reuse trials ran on the GB10 on 2026-10-25 and are recorded in [CLAIMS.md](CLAIMS.md). The full procedure in section 3 (K = 3 labelled runs, N = 10 reuse trials each, then `evidence_report`) is not recorded as run; the report generator was tested only on synthetic fixtures (`experiments/gb10_bench/fixtures/synthetic_*`, which it rejects on purpose). Unknown stays "not measured", never 0. GPU inference needs a named operator's authorization (`docs/GB10_RUNBOOK.md` section 2); put that name in the run label or your notes.

### 1. Definitions (use these words, and only these, in the pitch)

| term | what it is | clock starts / stops | where it is recorded | NOT included |
|---|---|---|---|---|
| **Model inference latency** | time the served model spends on a request. Three parts: **TTFT** (request sent to first content or reasoning chunk, client side), **decode tok/s** = (completion_tokens - 1) / (e2e - TTFT), **total generation time** (`e2e_s`, request to last chunk) | per request, in `ttft.py` | `ttft-c<C>-<i>.json` `trials[]`; server side `/metrics` (runbook M3b) | tests, skill execution, human time |
| **Validation latency** | time the host spends checking a candidate skill: lint, the skill's own tests, INC-1 replay, capacity check, hidden suite. Tests, no model | `synthesized` to `verified` audit events | `oncall-run.json` `audit[].t` (**1 s resolution**, derived by the report); not stored as its own field | model time, approval |
| **Deterministic reuse latency** | match + `run_skill` of an approved, pinned skill on a compatible incident. **No LLM**; the `NoModel` guard counts any attempt and `model_calls` must be 0 | `perf_counter` around `_decide` + `run_skill` in `oncall.reuse` | `oncall-run.json` `reuse.latency_ms`, `reuse.model_calls` | hidden-suite validation, human approval, applying the change (the skill only proposes) |
| **End-to-end response time** | what a person waits for one task. Must be stated per path: first-time = incident loaded to candidate staged at `pending_approval` (model + validation, **excluding human wait**); reuse = the reuse latency above | audit `incident_loaded` to `pending_approval` | derived by the report from `audit[].t` | the person's reading and approval time (unbounded; never averaged in) |

Rules: never write "latency" without one of these four prefixes. TTFT, decode tok/s and `e2e_s` describe the model, not the task. A "speed-up" must name both endpoints, e.g. "first-time automated end-to-end s versus reuse latency ms", and say what each leaves out.

#### Where the existing code or docs blur these (found in the audit; core is frozen, so only reported)

1. `oncall.py` `synthesize_live` times `synthesis.latency_ms` over the whole attempt loop: model requests **plus** in-loop `sf.lint` and the skill's own sandboxed tests. The field reads like model latency, and `frontier_report.py` publishes it as `e2e_latency_ms` ("e2e ms"). It is model + validation of the first attempt(s), not inference, and it excludes the hidden suite. The report here labels it that way.
2. `reuse.latency_ms` (match + `run_skill`) must not be quoted as a speed-up over `synthesis.latency_ms` (the pitch and Q&A now say so explicitly). The two measure different scopes: reuse leaves out hidden-suite validation and approval; synthesis leaves out the hidden suite too, but includes model time. A ratio of the two is only meaningful with that caveat spelled out (the report prints it).
3. `reuse.latency_ms` includes `sf.run_skill`, which starts the sandbox (a child process, or a throwaway Docker container with `SKILL_RUNNER=docker`). On the dev box the Docker start dominated skill runs (`docs/ARCHITECTURE.md`: 3,555 ms vs 43 ms compute). So "deterministic reuse is fast" depends on the runner; state `SKILL_RUNNER`.
4. `docs/GB10_RUNBOOK.md` M4 called `ttft.py`'s `e2e_s` "end-to-end generation time" and in the same row the Gate 5 `median_s`. These differ (one request vs one agent task with tools, verification and approvals). Fixed in the runbook: M4 now says "total generation time (one request)" and points Gate 5 `automated_s` at the end-to-end definition above.
5. `app/bench.py` `automated_s` is end-to-end (match, skill exec, execute, verify, agent turns) minus human approval seconds. It is **not** inference latency; its `model_calls` come from `task_end`. Mode A with `MockAgent` has `model_calls: None` and is plumbing only.
6. `ttft.py` TTFT counts the first reasoning chunk as the first token (`reasoning_content`/`reasoning`). For a reasoning model that is time to start thinking, not time to the first answer token.
7. `frontier.sh` runs the ttft stage (with 2 warm-up requests) **before** the OnCall stage, so the OnCall first-time run hits a **warm** model. No cold-model number comes out of this protocol unless the model was just loaded (section 3).
8. `samples.csv` spans the entire `frontier.sh` run; peaks are not per stage. `memory.used` is often blank on unified memory.
9. Tokens on the OnCall run are totals over all attempts, and null when the server returned no `usage`.

### 2. What the report needs (and where it comes from)

One result dir per run, `results/frontier/<label>/`, written by `frontier.sh`:

| file | by | feeds |
|---|---|---|
| `identity.json` | `frontier_report identity` | model identity, host/GPU proof, MemTotal |
| `ttft-c<C>-<i>.json` | `ttft.py` | TTFT, decode tok/s, request error rate |
| `samples.csv`, `stages.tsv`, `probe.json` | sampler, guards, `models.probe` | GPU/unified memory, temperature, stage and probe errors |
| `oncall-run.json` | `oncall_infer run --live`, then `reuse` | first-time model calls, synthesis wall ms, tokens, hidden results, approval, first reuse |
| `reuse-trials/reuse-<k>.json` | section 3 step 6 | N repeat reuse latencies |

The report rejects (exit 2) any dir whose `identity.json` GPU name does not contain `GB10`, whose name or files are marked mock/fixture/synthetic, or whose OnCall `mode` is not `LIVE_REAL_MODEL`. `--allow-mock` renders it under a MOCK banner for debugging only.

### 3. Procedure

Repo root on the GB10, after `docs/GB10_RUNBOOK.md` Gates 0 to 2 are GO and the operator has authorized GPU inference. K = 3 runs (3 labels), N = 10 reuse trials each.

```bash
# 0. Context. Write the authorizer's name and the runner into your notes.
export SKILL_RUNNER=docker            # or leave unset for the child-process sandbox; REPORT WHICH
python3 -m app check-llm              # one warm-up chat; confirms the served id

# 1. Per run k in 1..3: measure the served model, then OnCall first-time synthesis (STOPS for a person).
L=gb10-run1                           # then gb10-run2, gb10-run3
bash experiments/gb10_bench/frontier.sh $L --concurrency 1,2,4

# 2. A PERSON reads results/frontier/$L/oncall-run.json (code, hidden tests), then types the approve command that
#    frontier.sh printed (python -m app skill approve ... --by "<Full Name>"). Never an agent, never a script.

# 3. Reuse, first call after approval (writes reuse into oncall-run.json; model_calls must be 0).
bash experiments/gb10_bench/frontier.sh $L --after-approval

# 4. N repeat reuse trials. Trial 1 of the loop is warm for the OS cache but still a fresh process;
#    the first reuse after approval (step 3) is kept in oncall-run.json and reported as the cold-ish sample.
FR=results/frontier/$L; mkdir -p $FR/reuse-trials
for k in $(seq 1 10); do
  cp $FR/oncall-run.json $FR/reuse-trials/reuse-$k.json
  python3 -m experiments.oncall_infer reuse --state $FR/oncall-state --out $FR/reuse-trials/reuse-$k.json
done

# 5. Report (all runs side by side; runs are NOT pooled into one average)
python3 -m experiments.gb10_bench.evidence_report results/frontier/gb10-run1 results/frontier/gb10-run2 \
        results/frontier/gb10-run3 --out results/frontier/evidence_report.md
python3 -m experiments.gb10_bench.frontier_report report     # optional: the older merged table
```

Warm vs cold, stated plainly:
- **Model**: warm. Step 1 sends 2 discarded warm-up requests per concurrency before measuring, and OnCall runs after them. A cold-model first request is recorded only if the model was freshly loaded by someone else (note `docker inspect -f '{{.State.StartedAt}}'` of the vLLM container and run `FRONTIER_STAGES=oncall bash experiments/gb10_bench/frontier.sh <label>` as the first request). Do not restart, reload or switch the model to get it.
- **Reuse**: step 3 is the first reuse in a fresh state (new registry, sandbox start included); steps 4 trials are repeat runs. The report prints the first value alone and p50/p95 of the repeats.
- First-time LLM has n = 1 per run (it needs a person's approval). Three runs give three independent samples, shown separately. Do not call a mean of 3 a p95.

### 4. What to record by hand (not in any file)

- Authorizer name, operator name, UTC start and end, the label list.
- `SKILL_RUNNER` value, and whether `docker` containers were available.
- Which model profile was served and that you did not change it (`nemoclaw inference get --json` before and after).
- Anything you did that the scripts did not, as a manual hint (CLAUDE.md: record every manual hint).
- Screenshots only as supplementary (item 18 of the evidence map below).

### 5. Acceptance checks before any number is quoted

1. The report was produced without `--allow-mock` and has no MOCK banner.
2. "Model identity" says all files agree, and the served id matches `docs/ARCHITECTURE.md`/the pitch wording.
3. First-time `model_calls` is at least 1 and `mode` was `LIVE_REAL_MODEL`; every counted reuse trial has `model_calls == 0`. "Trials failing the contract" is 0, or you report the failures.
4. Hidden suite result and approval (`kind: host_cli`, a person's name) are present, or the first-time row is quoted as "candidate not approved".
5. Quote reuse and first-time as two latencies with their scopes (section 1). The ratio line is context, not the headline.
6. Anything shown as "not measured" stays "not measured" in the slides.

A GB10 figure in the pitch or the docs is quoted only from [CLAIMS.md](CLAIMS.md), where each number names its source file and sha256. A figure without such a file is the operator's report and is labelled that way.

### 6. Evidence map: item, source file, claim it supports

Paths: `EV/<cmd>` = `results/gb10-evidence/<UTC>-<cmd>/`, written by `deploy/gb10/sf-gb10.sh`; `FR` = `results/frontier/<label>/`, written by `sf-gb10.sh bench <label>` (which runs `experiments/gb10_bench/frontier.sh`). Merged report: `python -m experiments.gb10_bench.frontier_report report` writes `results/frontier/frontier.md` and `frontier.json`. Null or `[N/A]` stays null; never write 0.

| # | Item | Where it comes from | Supports the claim | Recorded (2026-10-25) |
|---|---|---|---|---|
| 1 | Hardware identity (host, arch, GPU name, driver) | `EV/preflight/console.txt`; `FR/identity.json` `host`, `gpu` | "Ran on a Dell GB10" | yes, [CLAIMS.md](CLAIMS.md) |
| 2 | vLLM image and version | `FR/identity.json` `container.image`, `server.vllm_version` | "served by vLLM <version>" | yes (0.21.0+2325b6f0.dev) |
| 3 | Served model id + revision | `EV/preflight/models.json`; `FR/identity.json` `model.revision` (may be null) | the model name in the pitch | id yes; revision not reported |
| 4-6 | `/health`, `/v1/models`, one chat completion | `EV/preflight/console.txt`, `models.json`, `check-llm.json` (`"mock": false`) | "local inference verified" | yes |
| 7-8 | TTFT p50/p95, decode tok/s | `FR/ttft-c<C>-<i>.json` `trials[]`; `frontier.md` | the TTFT and decode numbers | yes, per request |
| 9-10 | Unified memory, temperature | `FR/samples.csv`; preflight `MemAvailable` | headroom, "stayed under N C" | yes |
| 11 | OnCall model calls, synthesis wall ms (model requests + in-loop lint + the skill's own tests; not pure inference latency), tokens | `EV/oncall/oncall-run.json` `synthesis.*` | "the local model wrote the skill in N calls, T s" | yes (attempts 4 and 5 committed under `docs/evidence/gb10/`) |
| 12-13 | Generated code saved; hidden-test results | `synthesis.code`, `synthesis.provenance == "model"`, `mode == "LIVE_REAL_MODEL"`, `verification.hidden[]` | "model-written skill passed k/9 hidden cases" | yes |
| 14-15 | Approval by a person; skill version + sha256 | `EV/reuse/oncall-run.json` `approval.*`, `synthesis.skill_hash`; registry audit `skill_approved` | "a person approved it on the host", "hash-pinned skill" | yes (`host_cli`; name not identity-verified) |
| 16-17 | INC-2 reuse; INC-3 refusal | `reuse.state == "done"`, `model_calls == 0`, `latency_ms`; `refusal.state == "refused"` | "0 model calls on reuse", "lookalike refused" | yes, `docs/evidence/gb10/reuse-oncall-run.json` |
| 18 | Screenshots of `#/demo` scenes 4-6 (banners LIVE REAL MODEL, DETERMINISTIC SKILL; approval "Approved by <name>") | next to `EV/reuse/` | visual proof | not in this repository |
| 19 | Sandbox runner used | whether `SKILL_RUNNER=docker` was exported | "container-isolated verification" | subprocess runner for the timed runs; Docker re-verification of the approved skill is recorded in [CLAIMS.md](CLAIMS.md) |

Consistency checks before quoting anything: `generated_at` in `oncall-run.json` is later than the preflight time and
`host` is the GB10 hostname, not `<dev-box>`; `model.id` equals an id in `models.json`; the `skill_hash` in `EV/oncall`
equals the one in `EV/reuse`; the bench's OnCall run (`FR/oncall-run.json`) is a separate registry, so quote it as the
bench run, not as the demo run.

