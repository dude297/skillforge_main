# Deployment manifest: pinned versions, sizes, and offline staging

The values below were gathered from registries, Hugging Face, GitHub and NVIDIA docs. Every row has a source in [research/deploy_sources.md](research/deploy_sources.md).
- **V** means verified in a registry, API or official doc.
- **I** means inferred.
- **?** means unknown, and stays unknown until checked on the box.

An arm64 manifest does **not** prove that a container works on the GB10 GPU. The only GPU evidence for a container is NemoClaw's own `validation.level: hardware` on DGX Spark, and the Dell GB10 build may differ from it.

## 1. Pins

| component | pin | size | label |
|---|---|---|---|
| NemoClaw | installer `lkg` tag = **v0.0.135** (commit `7a099aeb…`); `curl -fsSL https://www.nvidia.com/nemoclaw.sh \| bash`; pin it with `NEMOCLAW_INSTALL_TAG=v0.0.135` | sandbox image about 2.4 GB | V |
| OpenShell | **0.0.116**, pinned by NemoClaw (upstream is v0.1.5; do not self-update) | — | V |
| OpenClaw (sandbox) | **2026.9.2**, pinned by NemoClaw (upstream is 2026.10.5) | — | V |
| Node.js (host) | NemoClaw needs **≥ 22.19.0**, npm ≥ 10. Recommended **v22.23.3** `node-v22.23.3-linux-arm64.tar.xz` sha256 `a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f` | about 30 MB | V |
| Docker | server **28.x+** (Spark playbook); containerd image store OK | — | V |
| GPU driver | **≥ 580.65.06** (NemoClaw Spark gate). DGX OS 7.5.0 ships 580.159.03 with CUDA 13.0.2; the Dell build is ? | — | V / ? |
| Runner image | `python:3.12-slim` index `sha256:2259debdc6af85626058a15a7bf44ad6a68b8c98c9ae82a02cf5cdb92f096d47`; arm64 `sha256:6c6ae3622772575c3ac02ecb2b02a06d05f19e1713a0cbff476ef37bca79e90f`. The tag is **mutable**, so use the digest. | 43.5 MB compressed | V, **staged** |
| pytest wheels | pytest 8.4.2 plus iniconfig, packaging, pluggy, pygments (pure Python) | 1.8 MB | **staged** |
| Default model profile | `vllm.dgx-spark-gb10.single.qwen3-6-35b-a3b-nvfp4`: **supported**, chosen automatically | — | V |
| … image | `nvcr.io/nvidia/vllm@sha256:9204569b17ee4c0eff75194b8e6e458479c8aee18953b5ab9cf359fcdac659e2`, the arm64 manifest of `26.05.post1-py3`. Inside: vLLM 0.21.0, CUDA 13.2.1, `MAXSMVER=121` | **9.60 GB** compressed, 27.7 GB unpacked | V |
| … weights | `nvidia/Qwen3.6-35B-A3B-NVFP4` rev `491c2f1ea524c639598bf8fa787a93fed5a6fbce` (weights identical to HEAD), apache-2.0, not gated. 3 safetensors; sha256 values are in the sources file §3a | **23.4 GB** | V |
| … serve flags | `--tool-call-parser qwen3_coder --reasoning-parser qwen3 --max-model-len 262144 --gpu-memory-utilization 0.4 --moe-backend marlin --max-num-seqs 4` | — | V |
| Experimental profile | `vllm.dgx-spark-gb10.single.nemotron-3.5-lightning-30b-a3b-nvfp4`: **experimental, explicit-only** (`nemoclaw onboard --profile <id>`) | — | V |
| … image | `vllm/vllm-openai@sha256:3af90144a0926e5c5fe46ee16e5201e763dd854538b9d7ce433755f11dadaf78`, a **cu129 nightly**, *not* v0.27.1; arm64 `sha256:c09345a2…a946d7` | **12.7 GB** compressed | V |
| … weights | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` rev `0dcd680e5585c791728c83342b311d0a0026dbeb`; license **OpenMDW-1.1**; not gated; 52 safetensors | **21.6 GB** | V |
| … serve flags | `--tool-call-parser step3p5 --reasoning-parser step3p5`, `VLLM_USE_RUST_FRONTEND=0`, `--max-model-len 65536 --max-num-seqs 1 --gpu-memory-utilization 0.65`. Served name: `nvidia-nemotron-3.5-lightning-30b-a3b-nvfp4`. Reasoning comes back in `message.reasoning`, so use `max_tokens` ≥ 1024 (our default is now 2048). | — | V |
| `vllm/vllm-openai:v0.27.1` | Only the HF card's recipe uses it (`qwen3_coder` parser, 1M context, separate DSpark draft model). We do **not** use it. arm64 `sha256:1c8e60a0…`, 10.5 GB | — | V |

**Parser conflict (Lightning).**
- NemoClaw's recipe uses `step3p5`, and its docs call the parser one reason the profile is still experimental.
- The HF card uses `qwen3_coder` and `nemotron_v3`.

We use NemoClaw's fixed recipe, which rejects overrides. Gate 1's `check-llm` tests structured output with whichever parser is actually served.

## 2. Storage

| item | bytes | where |
|---|---|---|
| light stage (`scripts/offline.sh stage`) | **48 MB** | USB, **done** (`../gb10-stage`) |
| Qwen image + weights | 9.6 + 23.4 = **33 GB** to download; about 51 GB on disk after unpacking (27.7 + 23.4) | needs approval |
| Lightning image + weights | 12.7 + 21.6 = **34 GB** to download; unpacked size is ? (estimate about 55 GB) | optional, needs approval |
| NemoClaw sandbox + gateway images | about 2.4 GB compressed (more unpacked) | fetched by the installer, cannot be pre-staged without the box |

- **Recommended external SSD:** 256 GB, or at least 128 GB. Both models plus the images come to about 70 GB, with room for `docker save` tars.
- **Free disk on the GB10:** at least 120 GB for both models, at least 60 GB for Qwen only (Gate 0 checks 60 GB).

## 3. Offline staging (`scripts/offline.sh`)

```bash
bash scripts/offline.sh stage   ../gb10-stage   # wheels + arm64 runner image (pinned digest) + git bundle + SHA256SUMS + inventory.json
LARGE_OK=1 bash scripts/offline.sh large ../gb10-stage   # heavy: vLLM image + model weights. Not run (needs approval); the models were already on the SSD
bash scripts/offline.sh verify  /media/usb/gb10-stage   # on the GB10: sha256 -c + inventory
bash scripts/offline.sh restore /media/usb/gb10-stage   # docker load, pip --no-index, git clone from bundle
```

**Restore rehearsal: verified.**
- **Setup:** an arm64 container (QEMU) with `--network none` and the stage dir mounted read-only.
- **Result:**
  - `sha256sum -c` OK
  - `pip install --no-index` from the staged wheels OK
  - repo cloned from the bundle
  - `tests/test_core.py` + `tests/test_contracts.py`: **39 passed, 1 skipped**
- **Also checked:** `docker load` of the staged tar on the host OK.

**Re-stage after the last commit you intend to run**, because the bundle contains the code as of staging time.

Even when the heavy assets are staged, NemoClaw's onboarding pulls the vLLM image and downloads weights through its own containers. Pre-staged images and the HF cache only help if they are placed where NemoClaw looks: `docker load` for images, and `~/.cache/huggingface` for weights (INFERRED; check `nemoclaw onboard` logs). Ask the organisers before you rely on this.

## 4. What still needs network

| step | host | avoidable offline? |
|---|---|---|
| NemoClaw installer + git ref | nvidia.com, github.com | no |
| npm `openclaw@2026.9.2`, nvm Node | registry.npmjs.org, nodejs.org | Node yes (tarball above); npm no |
| sandbox / gateway images | Docker Hub / GHCR | no (unknown digests until install) |
| Qwen vLLM image | nvcr.io (**NGC login per docs**; an anonymous token worked today) | yes, if staged (`large`) and NemoClaw accepts a local image (?) |
| Lightning vLLM image | Docker Hub | same |
| weights | huggingface.co (`HF_TOKEN` optional; set it if you get HTTP 429) | yes, if staged into the HF cache (?) |
| Telegram/Discord/Slack bridge | api.telegram.org etc. | no |
| this repo | none (git bundle) | **yes** |

**Telemetry:** NemoClaw sends anonymous telemetry by default. Run `export NEMOCLAW_DISABLE_TELEMETRY=1` in every shell.
