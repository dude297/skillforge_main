#!/usr/bin/env bash
# Offline staging for the GB10 (copy the stage dir to a USB/SSD). Idempotent; never touches host settings.
#   bash scripts/offline.sh stage   [DIR]   download LIGHT assets (wheels, runner image, repo bundle) + checksums
#   bash scripts/offline.sh large   [DIR]   HEAVY assets (vLLM image ~10-20 GB, model weights ~20+ GB): needs LARGE_OK=1
#   bash scripts/offline.sh verify  [DIR]   sha256 check + inventory (run on the GB10 before restoring)
#   bash scripts/offline.sh restore [DIR]   docker load + pip install from wheels + clone repo (on the GB10)
# DIR defaults to ../gb10-stage. Pins live in docs/DEPLOY_MANIFEST.md; keep them in sync with the vars below.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$PWD
DIR=$(mkdir -p "${2:-../gb10-stage}" && cd "${2:-../gb10-stage}" && pwd)
PY_TAG=${PY_TAG:-312}  # Ubuntu 24.04 / DGX OS python3 = 3.12
RUNNER_IMAGE=${RUNNER_IMAGE:-python:3.12-slim}
RUNNER_DIGEST=${RUNNER_DIGEST:-sha256:2259debdc6af85626058a15a7bf44ad6a68b8c98c9ae82a02cf5cdb92f096d47}  # OCI index digest
# NemoClaw LKG v0.0.135 pins (docs/DEPLOY_MANIFEST.md). Lightning instead: VLLM_IMAGE=vllm/vllm-openai@sha256:3af90144a0926e5c5fe46ee16e5201e763dd854538b9d7ce433755f11dadaf78
#   MODEL_REPO=nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 MODEL_REV=0dcd680e5585c791728c83342b311d0a0026dbeb
VLLM_IMAGE=${VLLM_IMAGE:-nvcr.io/nvidia/vllm@sha256:9204569b17ee4c0eff75194b8e6e458479c8aee18953b5ab9cf359fcdac659e2}
MODEL_REPO=${MODEL_REPO:-nvidia/Qwen3.6-35B-A3B-NVFP4}
MODEL_REV=${MODEL_REV:-491c2f1ea524c639598bf8fa787a93fed5a6fbce}
WHEELS="pytest==8.4.2"
PY=$(command -v python3 >/dev/null && python3 -c "" 2>/dev/null && echo python3 || echo python)

sums() { (cd "$DIR" && find . -type f ! -name SHA256SUMS ! -name inventory.json -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS); }
inventory() {  # inventory.json: every staged file + size (what to expect on the USB)
  (cd "$DIR" && $PY -c '
import json, os
rows = [{"path": os.path.relpath(os.path.join(r, f)).replace(os.sep, "/"), "bytes": os.path.getsize(os.path.join(r, f))}
        for r, _, fs in os.walk(".") for f in fs if f != "inventory.json"]
rows.sort(key=lambda x: x["path"])
total = sum(x["bytes"] for x in rows)
json.dump({"files": rows, "total_bytes": total}, open("inventory.json", "w"), indent=1)
print("inventory: %d files, %.1f MB" % (len(rows), total / 1e6))')
}

stage() {
  mkdir -p "$DIR/wheels" "$DIR/images" "$DIR/repo"
  echo "== wheels (linux aarch64, cp$PY_TAG) -> $DIR/wheels"
  $PY -m pip download --quiet --dest "$DIR/wheels" --only-binary=:all: --python-version "$PY_TAG" \
       --platform manylinux2014_aarch64 --platform manylinux_2_17_aarch64 $WHEELS
  echo "== runner image (linux/arm64) -> $DIR/images"
  ref=$RUNNER_IMAGE${RUNNER_DIGEST:+@$RUNNER_DIGEST}
  docker pull --quiet --platform linux/arm64 "$ref" >/dev/null
  # containerd image store keeps every platform under one tag: always name the platform explicitly
  [ "$(docker image inspect --platform linux/arm64 -f '{{.Architecture}}' "$ref")" = arm64 ] || { echo "no arm64 variant"; exit 1; }
  docker image inspect --platform linux/arm64 -f '{{index .RepoDigests 0}} {{.Id}}' "$ref" > "$DIR/images/python-3.12-slim-arm64.digest"
  docker save --platform linux/arm64 -o "$DIR/images/python-3.12-slim-arm64.tar" "$ref"
  echo "== app repo bundle (all branches) -> $DIR/repo"
  git -C "$REPO" bundle create "$DIR/repo/local-agent-foundation.bundle" --all 2>/dev/null
  git -C "$REPO" rev-parse HEAD > "$DIR/repo/HEAD"
  cp "$REPO/docs/DEPLOY_MANIFEST.md" "$REPO/docs/GB10_RUNBOOK.md" "$DIR/" 2>/dev/null || true
  # the console is served as static files by `python -m app ui`: ship the BUILT bundle so the GB10 needs no Node
  if [ -f "$REPO/ui/dist/index.html" ]; then
    tar -czf "$DIR/repo/ui-dist.tar.gz" -C "$REPO/ui" dist && echo "== console bundle -> $DIR/repo/ui-dist.tar.gz"
  else
    echo "WARN no ui/dist: run 'npm run build' in ui/ first, or the console will say 'console not built'"
  fi
  sums; inventory
  echo "staged: $DIR   (copy the whole dir; verify with: bash scripts/offline.sh verify <dir>)"
}

large() {
  [ "${LARGE_OK:-}" = 1 ] || { echo "refusing: heavy assets need explicit approval -> LARGE_OK=1 (see DEPLOY_MANIFEST sizes)"; exit 2; }
  mkdir -p "$DIR/images" "$DIR/models"
  echo "== $VLLM_IMAGE (linux/arm64) - needs NGC access; ~10-20 GB"
  docker pull --platform linux/arm64 "$VLLM_IMAGE"
  docker save --platform linux/arm64 -o "$DIR/images/$(echo "$VLLM_IMAGE" | tr '/:@' '___' | cut -c1-80).tar" "$VLLM_IMAGE"
  echo "== $MODEL_REPO@$MODEL_REV - needs the HF CLI (pip install huggingface_hub) and possibly HF_TOKEN"
  command -v hf >/dev/null && HF=hf || HF=huggingface-cli
  $HF download "$MODEL_REPO" --revision "$MODEL_REV" --local-dir "$DIR/models/$(basename "$MODEL_REPO")"
  sums; inventory
}

verify() {
  [ -f "$DIR/SHA256SUMS" ] || { echo "no SHA256SUMS in $DIR"; exit 1; }
  (cd "$DIR" && sha256sum --quiet -c SHA256SUMS) && echo "PASS checksums ($(wc -l < "$DIR/SHA256SUMS") files)"
  inventory
}

restore() {
  verify
  docker load -i "$DIR/images/python-3.12-slim-arm64.tar"
  for t in "$DIR"/images/*.tar; do case $t in *python-3.12-slim*) ;; *) docker load -i "$t" ;; esac; done
  python3 -m pip install --user --no-index --find-links "$DIR/wheels" pytest 2>/dev/null \
    || python3 -m pip install --user --break-system-packages --no-index --find-links "$DIR/wheels" pytest
  [ -d "$HOME/local-agent-foundation" ] || git clone -q "$DIR/repo/local-agent-foundation.bundle" "$HOME/local-agent-foundation"
  [ -f "$DIR/repo/ui-dist.tar.gz" ] && mkdir -p "$HOME/local-agent-foundation/ui"     && tar -xzf "$DIR/repo/ui-dist.tar.gz" -C "$HOME/local-agent-foundation/ui" && echo "console bundle restored (ui/dist)"
  echo "restored. next: cd ~/local-agent-foundation && bash scripts/gb10_preflight.sh gate0"
}

case "${1:-}" in
  stage|large|verify|restore) "$1" ;;
  *) sed -n 2,8p "$0"; exit 2 ;;
esac
