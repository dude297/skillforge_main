# Deployment research manifest: Dell Pro Max GB10 / DGX Spark

Labels: **VERIFIED** means I saw it today in an official source, registry or API response. **INFERRED** means it is reasoned from verified facts and was not stated directly. **UNKNOWN** means not found. No digest, size or checksum below was guessed.

Abbreviations:
- **NC-LKG** is the NemoClaw `lkg` tag. It is the default target of the hosted installer. Tag object `58c64f97…`, commit `7a099aeb4f6678d9b9ce6236535e7b41b03c81a2`, release v0.0.135.
- **NC-main** is NemoClaw `main` at `95d0ed24726403b717e62bc29a303ed9e8350ec4`.
- URL bases: `GH-NC` = https://github.com/NVIDIA/NemoClaw/blob/7a099aeb4f6678d9b9ce6236535e7b41b03c81a2/ (LKG); `GH-OS` = https://github.com/NVIDIA/OpenShell/blob/; `GH-OC` = https://github.com/openclaw/openclaw/blob/3928bad9badfcb6c7d140530435e806fb8092190/ (tag v2026.9.2).

---

## 0. Surprises and contradictions with our assumptions (read first)

| # | Our assumption | What the sources say | Label | Source |
|---|---|---|---|---|
| S1 | Lightning is served by `vllm/vllm-openai:v0.27.1` | The NemoClaw Spark recipe does **not** use v0.27.1. It pins `vllm/vllm-openai@sha256:3af90144a0926e5c5fe46ee16e5201e763dd854538b9d7ce433755f11dadaf78`. That digest is a multi-arch **index**; NemoClaw's doc wrongly calls it the "linux/arm64 digest". Its labels say `vllm/vllm-openai:cu129-nightly-f25953cc59f9b4ba9b04b16228d2b86dcfbcbdb1` with CUDA 12.9.1. Only the HF model card recommends v0.27.1, and the card's recipe is different: DSpark speculative decoding, `qwen3_coder` parser, 1M context. | VERIFIED | `GH-NC` managed-inference/recipes/vllm.nemotron-3.5-lightning-30b-a3b-nvfp4.spark-single.v1.yaml; `docker buildx imagetools inspect`; HF card |
| S2 | Tool-parser conflict between step3p5 and qwen3_coder | Both are real, but they come from different sources. **NemoClaw** recipe: `--tool-call-parser step3p5 --reasoning-parser step3p5` plus `VLLM_USE_RUST_FRONTEND=0`, because the Rust frontend lacks step3p5. **HF card**: `--tool-call-parser qwen3_coder --reasoning-parser nemotron_v3`. NemoClaw states that promotion out of Experimental "requires broader validation of … `step3p5` parsers". | VERIFIED | NC recipe and docs/inference/set-up-vllm.mdx; HF README |
| S3 | Qwen3.6 via nvcr vllm 26.05.post1 | Confirmed. The NemoClaw recipe pins the **arm64 manifest** digest `sha256:9204569b…c659e2`, and that matches registry metadata exactly: 9,603,085,145 bytes. However, the Qwen recipe uses `--tool-call-parser qwen3_coder`, while the HF card's Spark command uses `qwen3_xml`. NemoClaw also drops MTP and uses async scheduling. | VERIFIED | NC recipe; HF card |
| S4 | (implied) nvcr 26.05.post1 is a recent vLLM | The image environment says `VLLM_VERSION=0.21.0+2325b6f0` and `NVIDIA_VLLM_VERSION=26.05.post1`. The 26.05 release notes list vLLM **0.20.1**, CUDA 13.2.1, and say nothing about `.post1`. Upstream is 0.27.1. | VERIFIED | image config; https://docs.nvidia.com/deeplearning/frameworks/vllm-release-notes/rel-26-05.html |
| S5 | (implied) model revision = HF HEAD | NemoClaw pins **older revisions**: Qwen `491c2f1ea524c639598bf8fa787a93fed5a6fbce` (HEAD is `1355db6a…`) and Lightning `0dcd680e5585c791728c83342b311d0a0026dbeb` (HEAD is `bee75962…`). I diffed the file trees: the weights are byte-identical (same LFS sha256). Only README.md and accuracy_plot.png differ. Pinning either revision gives the same weights. | VERIFIED | HF tree API at both revisions |
| S6 | `/metrics` unauthenticated | For v0.27.1 the vLLM `AuthenticationMiddleware` only guards the prefixes `("/v1","/v2","/inference","/cohere")`, so `/metrics` and `/health` skip the bearer check. The Rust frontend guards `["/v1","/v2","/inference"]`. For the nvcr 0.21.0 build and the cu129 nightly this was not checked; I assume the same behaviour. | VERIFIED (v0.27.1 source), INFERRED (other images) | GH vllm `6e448d0e` vllm/entrypoints/serve/utils/server_utils.py L42-90; rust/src/server/src/middleware/auth.rs L16 |
| S7 | "Loopback always blocked by OpenShell" | Only partly true. Network policy **never authorizes outbound endpoints whose destination is loopback, link-local (incl. 169.254.169.254) or unspecified**, and `allowed_ips` entries overlapping 127.0.0.0/8 are rejected at load time. However, **sandbox-local loopback is not blocked**: a process may reach a service on 127.0.0.1 inside the same sandbox. Host loopback is unreachable; use `host.openshell.internal`. | VERIFIED | `GH-OS` main/docs/how-it-works/policies/network-rules.mdx ("Restrict Destination Addresses"); v0.0.116 docs/reference/policy-schema.mdx (`allowed_ips` row) |
| S8 | Preset: POST /call → `172.18.0.1:8765` from `/usr/bin/python3` | The documented NemoClaw pattern for sandbox→host services uses **`host: host.openshell.internal`**, not a raw bridge IP, with `allowed_ips: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]`. See the maintained `observability-otlp-local` preset (POST `/v1/traces` to `host.openshell.internal:4318`). Custom presets passed with `--from-file` **must not** declare `allowed_ips`, except on the `host.openshell.internal` bridge endpoint. NemoClaw "rejects untrusted private … destinations" and rejects private **IP literals** on the host-alias path. A preset with `host: 172.18.0.1` is therefore likely to be rejected or SSRF-blocked. Switch to `host.openshell.internal`. | VERIFIED (docs), INFERRED (that the IP-literal form fails) | `GH-NC` nemoclaw-blueprint/policies/presets/observability-otlp-local.yaml; docs/network-policy/create-custom-policy-presets.mdx L64-95; NC-main docs/inference/custom-endpoint-security.mdx L172-173 |
| S9 | nvcr pull needs NGC login? | NemoClaw docs say "Image pulls from `nvcr.io` require NGC registry login". However, `https://nvcr.io/proxy_auth?scope=repository:nvidia/vllm:pull` issued an **anonymous token** today, and the manifest inspect succeeded. Docker Desktop credsStore is in use locally, so I cannot rule out stored nvcr credentials. Plan for `docker login nvcr.io` with an NGC key to be safe. | VERIFIED (doc text + anonymous token), INFERRED (anonymous pull works) | NC docs/inference/set-up-vllm.mdx L262 |
| S10 | `openclaw agent --json` returns top-level `payloads/meta` | The **Gateway path** (default; `--local` is the only embedded path) prints the raw Gateway response: `{runId, status, summary, result:{payloads, meta, deliveryStatus}}`. So `payloads` is at **`.result.payloads`** and run metadata at **`.result.meta`**. The flat envelope (`ok/status/final/payloads/usage/assistantTurns/toolSummary`) is the documented contract of **`openclaw agent exec --json`**, a different command. | VERIFIED (source + docs) | `GH-OC` src/commands/agent-via-gateway.ts L80-95, L910-919, L1170-1172; docs/cli/agent.md |
| S11 | Lightning context | NemoClaw: `--max-model-len 65536`, `--max-num-seqs 1`, gpu-mem-util 0.65, MTP 1 token. HF card: 1M default with DSpark (an extra 1.35 GB draft repo). | VERIFIED | NC recipe; HF card |
| S12 | Lightning reasoning field | The pinned runtime returns reasoning in `choices[].message.reasoning`, not `reasoning_content`, which is null. Use `max_tokens` ≥ 1024. | VERIFIED | NC docs/inference/set-up-vllm.mdx ("Reading Reasoning…") |
| S13 | Upstream versions | Upstream OpenShell is at **v0.1.5**, but NemoClaw LKG pins **0.0.116**: MIN = MAX = PIN. Upstream npm `openclaw` latest is 2026.10.5, but NemoClaw LKG pins **2026.9.2** in the sandbox runtime. Do not self-update either. | VERIFIED | GH releases; `GH-NC` scripts/install-openshell.sh L120-128; agents/openclaw/openclaw-runtime/package.json; npm registry |
| S14 | Model card license | Lightning license is **OpenMDW-1.1** (`license:other`, https://openmdw.ai/license/1-1/), not Apache. Qwen3.6 NVFP4 is apache-2.0. Neither repo is gated. | VERIFIED | HF API |

---

## 1. NVIDIA NemoClaw

| Item | Value | Label | Source |
|---|---|---|---|
| Repo | https://github.com/NVIDIA/NemoClaw. Description: "Run agents like Hermes, LangChain Deep Agents, and OpenClaw more securely inside NVIDIA OpenShell with managed inference" | VERIFIED | GH API |
| Release the installer selects | Hosted installer default ref = `lkg` → **v0.0.135** (commit `7a099aeb4f6678d9b9ce6236535e7b41b03c81a2`). Newer tags exist (v0.0.136, v0.0.137, v0.1.0-rc1/rc2, v1.0.0-rc1) but are not LKG. `package.json` version string is `0.1.0`. | VERIFIED | `gh api repos/NVIDIA/NemoClaw/git/ref/tags/lkg`; install.sh L20 |
| Install command | `curl -fsSL https://www.nvidia.com/nemoclaw.sh \| bash`. Non-interactive: add `NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1` (or `bash -s -- --yes-i-accept-third-party-software`) and `NEMOCLAW_NON_INTERACTIVE=1 NEMOCLAW_AGENT=openclaw NEMOCLAW_SANDBOX_NAME=…`. Pin a ref with `NEMOCLAW_INSTALL_TAG`/`NEMOCLAW_INSTALL_REF`. | VERIFIED | `GH-NC` docs/get-started/quickstart.mdx; install.sh L322-323 |
| Telemetry | On by default (anonymous, "fixed TEST receiver"). Disable with `export NEMOCLAW_DISABLE_TELEMETRY=1` in every shell. | VERIFIED | quickstart.mdx |
| Node.js | `>=22.19.0` (package.json `engines`, `MIN_NODE_VERSION="22.19.0"`), npm ≥ 10. The installer upgrades through nvm with `nvm install 22`. | VERIFIED | `GH-NC` package.json L160-161; scripts/install.sh L1544, L3043 |
| Docker | Docker Engine on DGX OS (Spark) is "Tested". The Spark playbook requires Docker server **28.x or later**. Docker ≥ 26 with the containerd image store makes onboarding build a fuse-overlayfs cluster image automatically. | VERIFIED | docs/get-started/prerequisites.mdx; https://build.nvidia.com/spark/nemoclaw |
| OS / HW minimum | DGX OS (Spark), status Tested. Minimum 4 vCPU, 8 GB RAM, 20 GB disk (sandbox image is about 2.4 GB compressed). Also needs `binutils` (`strings`) and `zstd`. | VERIFIED | prerequisites.mdx |
| GPU driver gate (Spark presets) | `host.gpu.driver_version` must be at least **580.65.06**; arch arm64; docker runtime; CDI healthy; container toolkit present | VERIFIED | presets/vllm.dgx-spark-gb10.single.*.yaml |
| OpenShell installed | **0.0.116** (scripts/install-openshell.sh `MIN_VERSION=MAX_VERSION=PIN_VERSION="0.0.116"`; `@nvidia/openshell-sdk` 0.0.116) | VERIFIED | `GH-NC` scripts/install-openshell.sh L120-128; package.json L129 |
| OpenClaw installed (sandbox runtime) | **openclaw 2026.9.2**. Runtime engines: `node >=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0` | VERIFIED | `GH-NC` agents/openclaw/openclaw-runtime/package.json; npm registry |
| List / select profiles | `nemoclaw profiles list`, then `nemoclaw onboard --profile <id>` (optionally `--vllm-gpu-device <idx\|GPU-uuid>`). Do not combine with `NEMOCLAW_PROVIDER/MODEL/VLLM_MODEL/VLLM_EXTRA_ARGS_JSON`. | VERIFIED | NC docs/inference/set-up-vllm.mdx L124-153 |
| Spark default profile (automatic) | `vllm.dgx-spark-gb10.single.qwen3-6-35b-a3b-nvfp4`: supportState **supported**, selection `automatic`, priority 550, validation `hardware`. Recipe `vllm.qwen3-6-35b-a3b-nvfp4.spark-single.v1`. A 64 GB Spark variant also exists: `vllm.dgx-spark-gb10.single-64gb.qwen3-6-35b-a3b-nvfp4`. | VERIFIED | `GH-NC` managed-inference/presets/… |
| Lightning profile | `vllm.dgx-spark-gb10.single.nemotron-3.5-lightning-30b-a3b-nvfp4`: supportState **experimental**, selection **explicit-only**, priority 450, validation `schema`. Recipe `vllm.nemotron-3.5-lightning-30b-a3b-nvfp4.spark-single.v1`. Fixed recipe; it "intentionally rejects model and serve-argument overrides". | VERIFIED | same; set-up-vllm.mdx Warning |
| Other Spark vLLM profiles | qwen3-6-27b-fp8, nemotron-3-nano-4b-fp8, nemotron-3.5-super-vl-120b-a12b-nvfp4 (experimental), muse-glimmer-30b-nvfp4-w4a4, deepseek-r1-distill-llama-70b, dual-Spark deepseek-v4-flash-0731 (experimental). Plus llama.cpp presets. | VERIFIED | managed-inference/presets listing (NC-main) |
| Container name / port | `nemoclaw-vllm`. Host port `NEMOCLAW_VLLM_PORT` (default 8000) is published **only on 127.0.0.1 and the private IPv4 gateway of the `openshell-docker` bridge**, never on 0.0.0.0. Bearer auth (`serve.authentication: bearer`). The sandbox reaches it at `http://host.openshell.internal:<port>/v1`. | VERIFIED | set-up-vllm.mdx L23-34, L227-229 |
| HF cache | Weights go to `~/.cache/huggingface` through a one-shot downloader container running as the host UID. The long-lived vLLM container mounts the hub cache **read-only, offline mode**. The HF token is passed only to the downloader. | VERIFIED | set-up-vllm.mdx L368-370 |
| Network needed | (a) the installer at nvidia.com and GitHub (git ref); (b) npm registry (`npm pack openclaw@…`, nvm Node download); (c) Docker Hub / GHCR for the sandbox and managed images; (d) `nvcr.io` for the Qwen vLLM image (docs say NGC login is required; see S9); (e) Docker Hub for the Lightning image; (f) huggingface.co for weights (`HF_TOKEN` optional for ungated repos; export it if you get HTTP 429); (g) the Docker convenience script if Docker is missing. | VERIFIED (each listed in docs/scripts) | quickstart.mdx, prerequisites.mdx, set-up-vllm.mdx L262-292, scripts/install.sh L3110-3135 |
| Pull timeouts | Qwen recipe `pullTimeoutSeconds: 43200`; Lightning `3600`. Readiness timeout 1800 s for both. | VERIFIED | recipes |

### 1a. Qwen3.6-35B-A3B NVFP4 on Spark (NemoClaw recipe `vllm.qwen3-6-35b-a3b-nvfp4.spark-single.v1`)

| Field | Value | Label |
|---|---|---|
| Model / served name | `nvidia/Qwen3.6-35B-A3B-NVFP4` / `nvidia/Qwen3.6-35B-A3B-NVFP4` | VERIFIED |
| Pinned revision | `491c2f1ea524c639598bf8fa787a93fed5a6fbce` (weights identical to HEAD `1355db6a…`) | VERIFIED |
| Image | `nvcr.io/nvidia/vllm@sha256:9204569b17ee4c0eff75194b8e6e458479c8aee18953b5ab9cf359fcdac659e2` (= the arm64 manifest of `26.05.post1-py3`). imageDownloadSizeBytes 9,603,085,145; unpacked 27,658,526,720 | VERIFIED |
| minimumComputeCapability / GPU mem | 121 / 64,000,000,000 | VERIFIED |
| Runtime | network bridge, ipc host, shm 64 GiB, memlock -1, stack 64 MiB | VERIFIED |
| Args (≥ 64 GB) | `--max-model-len 262144 --gpu-memory-utilization 0.4 --dtype auto --quantization modelopt --kv-cache-dtype fp8 --attention-backend flashinfer --moe-backend marlin --max-num-seqs 4 --max-num-batched-tokens 8192 --enable-chunked-prefill --async-scheduling --enable-prefix-caching --enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser qwen3 --load-format fastsafetensors` | VERIFIED |
| 60–64 GB variant | ctx 32768, seqs 1, batched 4096, util 0.5, lazy safetensors; Experimental | VERIFIED (doc) |
| Capabilities declared | chat, streaming, toolCalls, reasoning. structuredOutputs **false**, multimodal false | VERIFIED |
| HF card Spark command (differs) | adds `--trust-remote-code`, MTP spec-config (3 tokens), `--tool-call-parser qwen3_xml`. Card suggests `vllm/vllm-openai:nightly`. | VERIFIED |

Source: `GH-NC` managed-inference/recipes/vllm.qwen3-6-35b-a3b-nvfp4.spark-single.v1.yaml, models/vllm.qwen3-6-35b-a3b-nvfp4.v1.yaml; https://huggingface.co/nvidia/Qwen3.6-35B-A3B-NVFP4

### 1b. Nemotron 3.5 Lightning 30B-A3B NVFP4 on Spark (recipe `vllm.nemotron-3.5-lightning-30b-a3b-nvfp4.spark-single.v1`)

| Field | Value | Label |
|---|---|---|
| Model / served name | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` / **`nvidia-nemotron-3.5-lightning-30b-a3b-nvfp4`** (alias differs from repo id) | VERIFIED |
| Display name | "NVIDIA Nemotron 3.5 Lightning 30B-A3B NVFP4 [Experimental]" | VERIFIED |
| Pinned revision | `0dcd680e5585c791728c83342b311d0a0026dbeb` (weights identical to HEAD `bee75962…`) | VERIFIED |
| Image | `vllm/vllm-openai@sha256:3af90144a0926e5c5fe46ee16e5201e763dd854538b9d7ce433755f11dadaf78` (index). arm64 manifest `sha256:c09345a2acfd57b0db5f0afae81ca682ec8117be0b370456d274a104a4a946d7`, 32 layers, 12,691,494,602 B (recipe says 12,691,539,532). Tag label `cu129-nightly-f25953cc…`, CUDA 12.9.1. | VERIFIED |
| Env | `VLLM_USE_RUST_FRONTEND=0` | VERIFIED |
| Args | `--max-model-len 65536 --max-num-seqs 1 --gpu-memory-utilization 0.65 --kv-cache-dtype fp8 --moe-backend marlin --max-num-batched-tokens 4096 --speculative-config '{"method":"mtp","num_speculative_tokens":1,"moe_backend":"flashinfer_cutlass"}' --mamba-backend flashinfer --mamba-ssm-cache-dtype float16 --enable-mamba-cache-stochastic-rounding --mamba-cache-philox-rounds 5 --enable-prefix-caching --mamba-cache-mode align --compilation-config '{"cudagraph_capture_sizes":[1,2,4,…,256,1024,2048,4096]}' --enable-auto-tool-choice --tool-call-parser step3p5 --reasoning-parser step3p5` | VERIFIED |
| Validation evidence | Physical single-Spark run: about 102 output tok/s average on 32K–42K-token inputs, about 33 GiB host memory free at 0.65 util | VERIFIED (doc claim) |
| HF card Spark command (differs) | image `vllm/vllm-openai:v0.27.1`, `--moe-backend marlin --kv-cache-dtype fp8 --enable-prefix-caching --gpu-memory-utilization 0.85 --speculative_config.num_speculative_tokens 3 --speculative_config.model nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark --mamba-backend flashinfer --mamba-cache-mode align --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder --enable-auto-tool-choice`. Validated context 1M. GB10 path is W4A16 via Marlin ("No — runs via Marlin"). | VERIFIED |
| DSpark draft repo (card recipe only) | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark` rev `6d127b50ecd98562cea85d0087680b7d86091fb0`, `model.safetensors` 1,349,057,504 B, sha256 `8eef955ebc5742513a76390cd745fb5fe4c132961a40254a4861f21764353311`, not gated | VERIFIED |

---

## 2. Container images (registry metadata)

| Image | Index digest | linux/arm64 manifest digest | arm64 layers (compressed sum) | Label |
|---|---|---|---|---|
| `nvcr.io/nvidia/vllm:26.05.post1-py3` | `sha256:94e21552f644e0c1627464ba89d2f7a4ce7442e196f72afa0bb5d7fba23cbb03` (docker manifest list) | `sha256:9204569b17ee4c0eff75194b8e6e458479c8aee18953b5ab9cf359fcdac659e2` | 41 layers, **9,603,085,145 B** (9.60 GB) | VERIFIED |
| `vllm/vllm-openai:v0.27.1` | `sha256:0a51ea5b4ae2dc5d81890e5173f54203d2a3ae0cfffe51b8fd2afd4391bfd967` | `sha256:1c8e60a0841b333c700488cb029d3664807249da0c071e862191b00fe34b228c` | 33 layers, **10,533,135,621 B** (10.53 GB) | VERIFIED |
| `python:3.12-slim` | `sha256:2259debdc6af85626058a15a7bf44ad6a68b8c98c9ae82a02cf5cdb92f096d47` (OCI index; **mutable tag**, 3.12.15-slim-trixie) | `sha256:6c6ae3622772575c3ac02ecb2b02a06d05f19e1713a0cbff476ef37bca79e90f` (arm64/v8) | 4 layers, **43,530,720 B** | VERIFIED |
| NemoClaw Lightning pin (for reference) | `sha256:3af90144a0926e5c5fe46ee16e5201e763dd854538b9d7ce433755f11dadaf78` | `sha256:c09345a2acfd57b0db5f0afae81ca682ec8117be0b370456d274a104a4a946d7` | 32 layers, 12,691,494,602 B | VERIFIED |

Method: `docker buildx imagetools inspect [--raw|--format '{{json .Image}}']` (manifest and config only, no layer pulls).

| Image | CUDA / runtime facts from image config | GB10 / sm_121 evidence | Label |
|---|---|---|---|
| nvcr vllm 26.05.post1 (arm64) | `CUDA_VERSION=13.2.1.009`, `CUDA_DRIVER_VERSION=595.58.03` (bundled compat), `VLLM_VERSION=0.21.0+2325b6f0`, `NVIDIA_VLLM_VERSION=26.05.post1`, `CUDA_ARCH_LIST=8.0 8.6 9.0 10.0 11.0 12.0`, **`MAXSMVER=121`**, `TORCH_CUDA_ARCH_LIST=… 12.0+PTX`, ModelOpt 0.43.0, Ubuntu 24.04, entrypoint `/opt/nvidia/nvidia_entrypoint.sh` | `MAXSMVER=121` plus `12.0+PTX` are image hints only. 26.05 release notes mention "on Spark" known issues (`--max-num-seqs 4` for Nemotron Nano/Super V3 NVFP4; lower `--gpu-memory-utilization` on unified memory) but have no explicit GB10 support statement. **Strongest evidence:** NemoClaw marks this digest `supportState: supported` with `validation.level: hardware` on DGX Spark. | VERIFIED |
| vllm-openai v0.27.1 (arm64) | `CUDA_VERSION=13.0.2`, `NVARCH=sbsa`, `TORCH_CUDA_ARCH_LIST=8.0 8.7 8.9 9.0 10.0 11.0 12.0` (no `+PTX`, no 12.1 listed), build commit `6e448d0ea9bf3d88d898b65449ca6dc2aec170ac`, entrypoint `vllm serve` | There is no NVIDIA statement for GB10 on this exact tag. The HF Lightning card names it the vLLM version for its DGX Spark recipe (VERIFIED). Whether sm_121 runs the sm_120 binaries is INFERRED (same major arch family); I did not confirm it. | VERIFIED / INFERRED |
| python:3.12-slim | Debian trixie base, Python 3.12.15 | n/a (CPU only) | VERIFIED |

Release notes: https://docs.nvidia.com/deeplearning/frameworks/vllm-release-notes/rel-26-05.html (26.05: CUDA 13.2.1, vLLM 0.20.1; ".post1" not documented there).

---

## 3. HuggingFace models

| Item | Qwen3.6-35B-A3B-NVFP4 | Lightning-30B-A3B-NVFP4 | Label |
|---|---|---|---|
| Repo | https://huggingface.co/nvidia/Qwen3.6-35B-A3B-NVFP4 | https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 | VERIFIED |
| HEAD sha | `1355db6a052410cfd62085d94b58866fd0f2c3c5` (2026-08-29) | `bee7596271d1495f6992ae224aefde4410e816b8` (2026-09-10) | VERIFIED |
| NemoClaw-pinned sha | `491c2f1ea524c639598bf8fa787a93fed5a6fbce` (2026-06-12) | `0dcd680e5585c791728c83342b311d0a0026dbeb` (2026-08-11) | VERIFIED |
| Weights pinned vs HEAD | identical (only README differs) | identical (only README and accuracy_plot.png differ) | VERIFIED |
| Gated | false | false | VERIFIED |
| License | apache-2.0 | other: **OpenMDW-1.1** (https://openmdw.ai/license/1-1/) | VERIFIED |
| Arch / library | `Qwen3_5MoeForConditionalGeneration`, `qwen3_5_moe`, ModelOpt | `NemotronHForCausalLM`, `nemotron_h`, transformers | VERIFIED |
| Safetensors | 3 files, **23,424,338,320 B** | 52 files, **21,561,882,284 B** | VERIFIED |
| All files total | 17 files, 23,462,477,857 B | 71 files, 21,583,785,438 B | VERIFIED |
| NemoClaw `downloadSizeBytes` | 23,500,000,000 (rounded) | 21,561,882,284 (exact match) | VERIFIED |

Fetch with: `hf download <repo> --revision <sha>`; HF API `https://huggingface.co/api/models/<repo>/tree/<sha>`.

### 3a. Qwen3.6-35B-A3B-NVFP4 safetensors (HEAD = pinned)

| File | Bytes | LFS sha256 |
|---|---|---|
| `model-00001-of-00003.safetensors` | 10006877608 | `07141c2db92e47bc08777132cd1a0323faf300eab3a7d7c111bc2bf075fda050` |
| `model-00002-of-00003.safetensors` | 10003595752 | `6dea9c759a0f941cf9e1cc1501216b0e107966a66c90425050e212efbd053f02` |
| `model-00003-of-00003.safetensors` | 3413864960 | `9758875fc55e49561165f4a44342b654c123c3e25c6811b34abb83553fb1a164` |

### 3b. Lightning-30B-A3B-NVFP4 safetensors (HEAD = pinned; all 52)

| File | Bytes | LFS sha256 |
|---|---|---|
| `model-00001-of-00052.safetensors` | 743427168 | `672c8bda10fdec0256e0819e112d2aa3a936cc3e5d311a05fd3ff773ca9a44b9` |
| `model-00002-of-00052.safetensors` | 731109880 | `b365ac815ea78b159c4c6b27be77f2ab24be3ce67f7f4017eb3ada2e81a27f4f` |
| `model-00003-of-00052.safetensors` | 38783920 | `8fbad8247cd4d256a6d376259b83b06972e8d0d00eae1718c7852856343f204b` |
| `model-00004-of-00052.safetensors` | 731109880 | `243a94b1f2b3a3790ff53c151effe116a141539045804df20c005a8c5d0de96f` |
| `model-00005-of-00052.safetensors` | 38783920 | `e675767a474777e76e7a3b61d30fa70812db34415f76385c17aaf25aab82d398` |
| `model-00006-of-00052.safetensors` | 46798848 | `8f8e9623934bc82a4a2af18af83888ce79bbdee4f506cda08375d4ab3435cbd1` |
| `model-00007-of-00052.safetensors` | 731109880 | `306aee6514a7daf559a771ce0c29fafc6de70036c30cf6208c3844283694eff3` |
| `model-00008-of-00052.safetensors` | 38783920 | `31235989ff64cae4d75b73a713d1acbc5205bd050bb1aeb5e573b553d07a0b45` |
| `model-00009-of-00052.safetensors` | 731109880 | `bcd6b2645a6b23588e721432745a1a159870087037a1f937db20f2a85e14dc7f` |
| `model-00010-of-00052.safetensors` | 38783920 | `5fae7d86c34396c2da17f6ebd3b912c29c81370f61266d42bc88c91875a4d783` |
| `model-00011-of-00052.safetensors` | 731110656 | `10237b58cd289cc6dd7609e48a7606bd5a120050dc3f189621d99d23c52566ab` |
| `model-00012-of-00052.safetensors` | 38783936 | `dfa4a2312fc9943eee6ba8558b8f4d748ed20e5032d3a04a821f29844cb4f2e4` |
| `model-00013-of-00052.safetensors` | 46798856 | `41feb27e33765c985a28f8aca69440a9aaa39db0bdf632c065cc49ee0f5a8fa7` |
| `model-00014-of-00052.safetensors` | 731110656 | `16653126b2716c7b8d402024e5fb3ce6eb052422d45d83a5f3e486f066fd30cc` |
| `model-00015-of-00052.safetensors` | 38783936 | `1016d76b1b0dad48f5b38e97c2def67aac446a582aed849f14533d988047fe34` |
| `model-00016-of-00052.safetensors` | 731110656 | `70aaec01374fea7dddc0e006f4ae91e1a4cd09b9f77a36b8ba48e5189288419f` |
| `model-00017-of-00052.safetensors` | 38783936 | `67763384429d40a0142b4b1d02c6a171a493a4d0c57086d38e2436ac05d33a86` |
| `model-00018-of-00052.safetensors` | 731110656 | `252e3fb2e6c37d1b41f49463607d928e39c96fe0eb499768cc2fe42d9bfffe8e` |
| `model-00019-of-00052.safetensors` | 38783936 | `3fd080a21df9cda2793957c3b7a3699b7356753cb6a6e519e3299303c4e004ab` |
| `model-00020-of-00052.safetensors` | 46798856 | `31dada97bfd50ecd0fee51aea0272fb75d6a6dc6303022cb6defb7e55dfbaf8d` |
| `model-00021-of-00052.safetensors` | 731110656 | `601a05eb0b228da1cbc5883f955cbb5a38f1379401501926a7576aebdfd757da` |
| `model-00022-of-00052.safetensors` | 38783936 | `4b3eb401a3152e9a392840e56ceaf29d5fba4b952cc7a38ef5ec72849ffd45ab` |
| `model-00023-of-00052.safetensors` | 731110656 | `1f92f9b4bc06f33f18db2cee651ffa868374b54dc3d3ad8ea88d8f222507d8d7` |
| `model-00024-of-00052.safetensors` | 38783936 | `64d36b45162fd22d57934962e00fa6b6c19a8ef9f36dc1fce1940d876ce28283` |
| `model-00025-of-00052.safetensors` | 731110656 | `1d8f5436a1e7c34e8644e4db0331d58ba75c8c9997f1dfed0b1797ce5d87e9fd` |
| `model-00026-of-00052.safetensors` | 38783936 | `97e410e491888aa263a4a1ec42b8dd5c25b4869a209ff1da6ec2c20592db5a97` |
| `model-00027-of-00052.safetensors` | 46798856 | `e67fb58638bf00b010323ad702be58addf95ac2c89ba4006b7d00cbf8bab2b7f` |
| `model-00028-of-00052.safetensors` | 731110656 | `1800ab07214a1746f26a01e575e0c979d129a9bce1f3ce030e11b38d40bda72b` |
| `model-00029-of-00052.safetensors` | 38783936 | `045dc61dc334cad87fdd227515739ba22ea04f9e6e0f9624b40a6ff1e146553a` |
| `model-00030-of-00052.safetensors` | 731110656 | `794679784bde068d4d812b824595efcd87ea4fa64168af18e1295d60ad6cfa89` |
| `model-00031-of-00052.safetensors` | 38783936 | `727bb1bf4829360596a2845ee2730536408c4f52b322fffd8afc6bd972de5e3f` |
| `model-00032-of-00052.safetensors` | 731110656 | `cc68cfd7f1e805422e6ab224638b115754adc3a84bdedebc71a4ee7b52159e0a` |
| `model-00033-of-00052.safetensors` | 38783936 | `ee8d3fc76401172bdcb6fe4ad3b08ed8a9f0bc6e28a86bc6757a0998b27569a0` |
| `model-00034-of-00052.safetensors` | 46798856 | `90c579b134e5b929903e7c8e897970109bb11574bcf50fceb72c65884388bae1` |
| `model-00035-of-00052.safetensors` | 731110656 | `d6b9441c3fb72f5d13dfb8dfc410c0c176d94217d2a7626d3fd96c4db31ac134` |
| `model-00036-of-00052.safetensors` | 38783936 | `130ee06f0ba0c8e760b7c57ae671458446ad8fd71548198d0005e8e553ba10a9` |
| `model-00037-of-00052.safetensors` | 731110656 | `7464b7b51237bd66e5469fc4cb67f10d7b490af34d16670d57b102a3cfec6754` |
| `model-00038-of-00052.safetensors` | 38783936 | `1a0ab61ef65a02dbf8455da1feb5eb059ff064bf04ce9d9db5216d0c849383f5` |
| `model-00039-of-00052.safetensors` | 731110656 | `9f31f2fa95027f718a91c731b4537172576c05db6f8ac05ff3d17de7b4c27219` |
| `model-00040-of-00052.safetensors` | 38783936 | `407f0e74455eb7050e6125f346c8434d4341ff07730cc670bc482b47f59521dc` |
| `model-00041-of-00052.safetensors` | 731110656 | `4e8442377f265c009f6f82cf07447cc735385db6a673507ec61e1228c6e1b324` |
| `model-00042-of-00052.safetensors` | 38783936 | `85ca012bff38fbbcb1171ea1d134d60db2bdeaf12e53f1b4e8cf6e36eaf319a3` |
| `model-00043-of-00052.safetensors` | 46798856 | `01c56b23b7ea692675bc6f5f77b2a4959a51091435befd41428527f7128ea18f` |
| `model-00044-of-00052.safetensors` | 731110656 | `a3ebcaf00a08bc25f838d255e1ca78f7a518dd5dd529d7d6199e3be27663b8dd` |
| `model-00045-of-00052.safetensors` | 38783936 | `e9d559259cb0ff6043d25e94c11607f8a8057c7646763b0cb69c38b457840028` |
| `model-00046-of-00052.safetensors` | 731110656 | `5e5cfe7a6e504ec49e1672a0c28dc14c1fd270b01740d6152e85932e9f2a2439` |
| `model-00047-of-00052.safetensors` | 38783936 | `96ffe8358c3e8303b16dbe43f5016ff4e2dd84d633d53e20a4f93a1e8356f7e7` |
| `model-00048-of-00052.safetensors` | 731110656 | `1dcdf08d0f47ac4378dc288e7f5426d8d1ab4d214a299613a967d50e7ab5d587` |
| `model-00049-of-00052.safetensors` | 38783936 | `25da4593995db643b74d5ab71bd0618a0d7158ddad12bec8956866afb1b8fea5` |
| `model-00050-of-00052.safetensors` | 731110656 | `ef5b1baa53abc6b6dfa24618ecbb3eac8a783dbfde456d8943d82f912f3c4d44` |
| `model-00051-of-00052.safetensors` | 38783936 | `2da1f6cbbcfb36bf96bda840fc1442fb661262ed77c33be9e6d001301a684a1e` |
| `model-00052-of-00052.safetensors` | 3599984132 | `85db447be6acf54d029665874440e19e4a3fad3f75c1db7e703c3442e3c13d2c` |

---

## 4. OpenShell network policy (version installed by NemoClaw LKG: 0.0.116; upstream latest v0.1.5)

| Item | Value | Label | Source |
|---|---|---|---|
| Top-level YAML | `version: 1`, `filesystem_policy`, `landlock`, `process` (static), `network_policies`, `network_middlewares` (dynamic, hot-reloadable) | VERIFIED | `GH-OS` v0.0.116/docs/reference/policy-schema.mdx |
| Entry | `network_policies.<key>: { name?, endpoints: [...], binaries: [...] }`. A connection is allowed only when **destination and calling binary match the same entry**. | VERIFIED | same; docs/sandboxes/policies.mdx L72 |
| Endpoint fields | `host`, `port` (or `ports`), `path` (endpoint selector glob), `protocol` (`rest`\|`websocket`\|`graphql`\|`mcp`\|`json-rpc`\|`tcp`; omitted = L4 passthrough), `tls` (`skip`; `terminate`/`passthrough` deprecated), `enforcement` (`enforce`\|`audit`), `access` (`read-only`\|`read-write`\|`full`, mutually exclusive with `rules`), `rules`, `deny_rules`, `allowed_ips`, `allow_encoded_slash`, credential fields… | VERIFIED | policy-schema.mdx (Endpoint Object) |
| REST rule | `rules: - allow: { method: POST, path: "/call" }`. Also optional `query`. `*`/`**` globs may cross `/`. | VERIFIED | policy-schema.mdx (REST Allow Rule) |
| Binary restriction | `binaries: - { path: /usr/bin/python3 }`. Globs `*`/`**` are allowed (e.g. `/opt/venv/bin/python3*`). Use the exact path that `openshell term` / logs report for the denied request. | VERIFIED | policy-schema.mdx (Binary Object); NC create-custom-policy-presets.mdx |
| NemoClaw preset wrapper | Top level `preset: { name: <rfc1123-label>, description }` plus `network_policies:`. Names must not collide with maintained presets; keys `npm_yarn` and `personal_open_internet` are reserved. | VERIFIED | `GH-NC` docs/network-policy/create-custom-policy-presets.mdx |
| SSRF / private IPs | Private addresses are blocked by default. **Exact hostnames** may reach the private IPs they resolve to (not for policy-advisor proposals). Wildcard and hostless endpoints need `allowed_ips`. **Loopback, link-local (incl. 169.254.169.254) and unspecified addresses are never authorized**; `allowed_ips` overlapping them is rejected. K8s/etcd ports 2379, 2380, 6443, 10250 and 10255 are blocked. "A rule for `host.openshell.internal` can still reach services on the gateway host." Sandbox-local 127.0.0.1 is allowed. | VERIFIED | `GH-OS` main docs/how-it-works/policies/network-rules.mdx; main docs/how-it-works/policies/schema.mdx L135-150; v0.0.116 policy-schema.mdx `allowed_ips` row |
| NemoClaw custom presets | Files passed with `--from-file`/`--from-dir` **must not** declare `allowed_ips`, except on the `host.openshell.internal` bridge endpoint. NemoClaw rejects untrusted private, loopback, link-local, metadata, unspecified, multicast and reserved destinations. | VERIFIED | create-custom-policy-presets.mdx L60-95 |
| `--trusted-private-host <host>` | NemoClaw flag (env `NEMOCLAW_TRUSTED_PRIVATE_HOSTS`, comma list), valid only with `--from-file`/`--from-dir`. It takes an **exact host** (rejects wildcard, suffix, CIDR, URL-shaped, unused, duplicate). NemoClaw resolves the host and inserts each validated address as an exact `allowed_ips` pin in memory. The pin set is refreshed only on re-apply. Rejected for built-in presets. | VERIFIED | same |
| Sandbox→host pattern (use this) | See YAML below. It mirrors the maintained `observability-otlp-local` preset. | VERIFIED (pattern), INFERRED (our port/path) | `GH-NC` nemoclaw-blueprint/policies/presets/observability-otlp-local.yaml, local-inference.yaml |
| Dry-run / validate | `nemoclaw <sandbox> policy add --from-file ./x.yaml [--trusted-private-host H] --dry-run`, then `--yes` to apply. Upstream: `openshell policy update <sb> … --dry-run` ("Shows the merged policy locally and does not call the gateway"; cannot be combined with `--wait`). The gateway validates the full candidate policy before activating it. | VERIFIED | NC create-custom-policy-presets.mdx; `GH-OS` v0.0.116 docs/sandboxes/policies.mdx L282-303, L531-546 |
| See denials | `openshell logs <sandbox> --tail --source sandbox`. OCSF lines look like `NET:OPEN [MED] DENIED /usr/bin/curl(64) -> httpbin.org:443 [policy:- engine:opa]`. Live dashboard: `openshell term`. Look for the reasons `credential_endpoint_mismatch` and `request_authority_mismatch`; a proxy CONNECT 403 means a policy refusal. `NEMOCLAW_NO_AUTO_AUDIT_LOGS=1` stops NemoClaw from auto-enabling OCSF audit logging. | VERIFIED | `GH-OS` v0.0.116 docs/observability/accessing-logs.mdx; policies.mdx L190-195, L590-602; NC changelog |
| Note on `request_authority_mismatch` | When you tunnel to a non-default port, send `Host: host.openshell.internal:8765`, including the port | VERIFIED | policies.mdx L602 |

Recommended replacement for our UNVERIFIED preset (`172.18.0.1:8765`):

```yaml
preset:
  name: hackathon-tool-bridge
  description: "POST /call to host tool server"
network_policies:
  hackathon-tool-bridge:
    name: hackathon-tool-bridge
    endpoints:
      - host: host.openshell.internal   # NOT 172.18.0.1 (private IP literal; rejected or SSRF-blocked)
        port: 8765
        protocol: rest
        enforcement: enforce
        allowed_ips:                    # allowed only on the host.openshell.internal bridge endpoint
          - 10.0.0.0/8
          - 172.16.0.0/12
          - 192.168.0.0/16
        rules:
          - allow: { method: POST, path: "/call" }
    binaries:
      - { path: /usr/bin/python3 }      # sandbox apt python3 (local-inference preset comment: python3=3.11.2)
```

Label: field names VERIFIED. That this exact file passes `policy add --dry-run` is INFERRED, so run the dry-run on the box. The host service must listen on the `openshell-docker` bridge gateway IP, not on 127.0.0.1 only, because host loopback is unreachable from the sandbox. Firewall the port to that subnet.

---

## 5. OpenClaw CLI (2026.9.2, the version pinned by NemoClaw LKG)

| Item | Value | Label | Source |
|---|---|---|---|
| Command | `openclaw agent --session-id X -m "…" --json --timeout N`. You need one selector (`--to`/`--session-key`/`--session-id`/`--agent`); blank values are rejected. It runs **through the Gateway** unless you pass `--local`. | VERIFIED (docs) | `GH-OC` docs/cli/agent.md |
| `--timeout` | Seconds. Default 600 (or `agents.defaults.timeoutSeconds`); `0` disables it | VERIFIED (docs) | same |
| Exit codes | 0 on a completed turn. 1 on error, timeout or cancel (after the JSON is written). 130/143 on SIGINT/SIGTERM. | VERIFIED (docs) | same |
| stdout | With `--json`, stdout carries JSON only; diagnostics go to stderr | VERIFIED (docs) | same |
| JSON shape (Gateway path) | `{ runId?, status?, summary?, result?: { payloads?: [{text?, mediaUrl?, mediaUrls?}], meta?, deliveryStatus? }, deliveryStatus? }`. `status` is `"ok"`/`"completed"` (exit 0), `"in_flight"` if a duplicate run is active, or anything else (exit 1). | VERIFIED (source); partially documented (docs show `payloads`/`meta` at top level only in the `--deliver` example) | `GH-OC` src/commands/agent-via-gateway.ts L80-95 (`AgentGatewayResult`, `GatewayAgentResponse`), L910-919 (`buildGatewayJsonResponse` returns the response as-is), L925-935 |
| `result.meta` (EmbeddedAgentRunMeta) | `durationMs`, `agentMeta?`, `aborted?`, `error?`, `stopReason?`, `pendingToolCalls?`, `toolSummary?`, `livenessState?`, `timeoutPhase?`, `finalAssistantVisibleText?`, `completion?`, … | VERIFIED (source only) | `GH-OC` src/agents/embedded-agent-runner/types.ts L188-244 |
| `meta.agentMeta` | `sessionId`, `provider`, `model`, `usage?`, `lastCallUsage?`, `promptTokens?`, `contextTokens?`, `compactionCount?`, `assistantTurns?`, `bridgeCalls?`, `codeModeEngaged?`, `costUsd?`, `fallbackAttempts?`, `sessionFile?` | VERIFIED (source). Docs confirm that "run-stat fields appear on `meta.agentMeta` … outer tool summary remains at `meta.toolSummary`". | types.ts L45-110; docs/cli/agent.md |
| `meta.toolSummary` | `{ calls, tools[], failures?, totalToolTimeMs? }` | VERIFIED (source + docs mention) | types.ts L151 |
| `stopReason` | `meta.stopReason?: string` (also `finishReason`/`stopReason` inside the completion trace) | VERIFIED (source only) | types.ts |
| Flat envelope (different command) | `openclaw agent exec --json` → `{ok,status,final,payloads,usage,costUsd,codeModeEngaged,assistantTurns,bridgeCalls,toolSummary,model,provider,sessionId}`. "Stable", documented. Exit 2 = timeout. | VERIFIED (docs) | docs/cli/agent.md (`agent exec`) |
| Session persistence | Sessions are reused until reset. Default `session.reset.mode: "none"` keeps the same `sessionId`; compaction manages context. Stored in `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite`. That reusing `--session-id X` continues the same transcript is INFERRED. | VERIFIED (lifecycle), INFERRED (CLI reuse) | `GH-OC` docs/concepts/session.md L150-170, L215 |
| Reset / delete | In chat: `/new` or `/reset`. However, `--message` does **not** run the slash-command dispatcher (only `$skill`/`/skill` expansion; `/compact` is rejected), so `/reset` via `-m` will probably not work (INFERRED). CLI: `openclaw sessions delete "<session-key>" --yes [--json]` (also `archive`, `cleanup --enforce`, `compact`). Simplest demo reset: use a fresh `--session-id`. | VERIFIED (docs) / INFERRED | docs/cli/sessions.md L101-151; docs/cli/agent.md Notes |
| Skill discovery paths (precedence high→low) | 1 `<workspace>/skills`, 2 `<workspace>/.agents/skills`, 3 `~/.agents/skills`, 4 `<state-dir>/skills` (default `~/.openclaw/skills`), 5 bundled/custodian, 6 `skills.load.extraDirs` + plugin skills. A `SKILL.md` anywhere up to 6 levels deep counts; the highest-precedence name wins. | VERIFIED (docs) | `GH-OC` docs/tools/skills.md L34-57 |
| Skill CLI | `openclaw skills list [--eligible] [--json] [--verbose] [--agent <id>]`, `openclaw skills info <name> [--json]`, `openclaw skills check [--agent <id>] [--json]` | VERIFIED (docs) | `GH-OC` docs/cli/skills.md L59-69 |
| Inside NemoClaw | Run as `nemoclaw <sandbox> exec -- openclaw …` or `nemoclaw <sandbox> connect` | VERIFIED | NC docs/configure-agents/configure-memory-search.mdx; quickstart.mdx |

---

## 6. Node.js

| Item | Value | Label | Source |
|---|---|---|---|
| NemoClaw host requirement | Node ≥ **22.19.0**, npm ≥ 10. Installer uses `nvm install 22`. | VERIFIED | `GH-NC` package.json; scripts/install.sh |
| OpenClaw 2026.9.2 engines | `>=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0` (applies where openclaw runs, i.e. the sandbox image) | VERIFIED | npm registry `openclaw@2026.9.2` |
| Recommended pin | **v22.23.3** (latest Jod LTS, released 2026-09-23). Satisfies both constraints. | VERIFIED (version), INFERRED (choice) | https://nodejs.org/dist/index.json |
| arm64 tarball (.tar.xz) | https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-arm64.tar.xz — SHA-256 `a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f` | VERIFIED | https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt |
| arm64 tarball (.tar.gz) | https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-arm64.tar.gz — SHA-256 `5ced2d48d1d7198739b7f86804de0171aefb6823b684b12341d3321afc3cb0b2` | VERIFIED | same |
| Alternative v24 (Krypton LTS) | v24.22.0. linux-arm64.tar.xz `fef00bb4d36e1c50104a9775a10359beee98f162b4104dd12472c75065c6a143`; .tar.gz `b7e7991d5407815adfa74a2a9cd4db683552c8ce32ff4a295c22e972849c3f5d` | VERIFIED | https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt |
| Signature | SHASUMS256.txt.asc (GPG) was **not verified** in this session | UNKNOWN | — |

---

## 7. GB10 / DGX Spark platform

| Item | Value | Label | Source |
|---|---|---|---|
| Current DGX OS (Spark Founders Edition) | **7.5.0**, GPU driver **580.159.03**, CUDA Toolkit **13.0.2**, kernel 6.17. GB10 partner systems such as the Dell Pro Max GB10 "may receive updates later", so the Dell box may be on an older build. | VERIFIED (FE), UNKNOWN (Dell build) | https://docs.nvidia.com/dgx/dgx-spark/release-notes.html (updated 2026-09-10) |
| Memory | "128 GB LPDDR5x unified system memory, 256-bit, 4266 MHz, 273 GB/s" | VERIFIED | https://docs.nvidia.com/dgx/dgx-spark/hardware.html |
| CPU / storage | 20-core Arm (10× Cortex-X925 + 10× Cortex-A725); 1 TB or 4 TB NVMe | VERIFIED | same |
| Compute capability | 12.1 (`minimumComputeCapability: 121` in NemoClaw Spark recipes; "compute capability 12.1" in NemoClaw docs) | VERIFIED (NemoClaw) | NC recipes; set-up-vllm.mdx |
| Driver floor (NemoClaw) | ≥ 580.65.06 | VERIFIED | NC presets |
| Image vs host CUDA | nvcr 26.05.post1 is built on CUDA 13.2.1 but host CUDA is 13.0.2; the driver is 580.x. The image bundles `/usr/local/cuda/compat` (driver 595.58.03 compat). Whether forward-compat is active on the GB10 iGPU is not verified here; NemoClaw's hardware validation of this digest on Spark suggests it works. | INFERRED | image env; NC preset `validation.level: hardware` |
| Known issues: memory | `nvidia-smi` shows "Memory-Usage: Not Supported" (iGPU, expected). `cudaMemGetInfo` under-reports free memory because it ignores reclaimable swap or page cache. Debug workaround: `sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'`. | VERIFIED | https://docs.nvidia.com/dgx/dgx-spark/known-issues.html |
| Known issues: vLLM on Spark | vLLM by default grabs about 100% of memory (OOM on unified memory), so set `--gpu-memory-utilization` (NemoClaw uses 0.4 for Qwen and 0.65 for Lightning). Nemotron Nano/Super V3 NVFP4 on Spark need `--max-num-seqs 4`. | VERIFIED | 26.05 release notes |
| Known issues: NVFP4 on GB10 | The Lightning card's hardware matrix says GB10 runs NVFP4 as **W4A16 via Marlin, "No" native FP4 tensor-core path**, so `--moe-backend marlin` is required in both recipes | VERIFIED | HF Lightning README "Hardware Matrix" |
| Spark playbook | https://build.nvidia.com/spark/nemoclaw: Docker server 28.x+, first run takes 30–60 min, HF token optional, two-Spark is Experimental | VERIFIED | playbook page (its "Last Updated" line and front-matter date disagree) |

---

## Appendix: unknowns
- Whether `nvcr.io/nvidia/vllm` can be pulled anonymously (an anonymous token was issued, but NemoClaw docs say login is required). → Run `docker login nvcr.io` (user `$oauthtoken`, NGC API key) ahead of time.
- Which DGX OS / driver version Dell ships on the Pro Max GB10. → Check `nvidia-smi` and `cat /etc/dgx-release` on the box.
- Whether `/metrics` is unauthenticated in vLLM 0.21.0 (nvcr) and in the cu129 nightly. Not checked; same behaviour assumed.
- That a policy with `host: 172.18.0.1` fails. I inferred this from docs; I did not test it.
