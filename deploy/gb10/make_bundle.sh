#!/usr/bin/env bash
# Build the portable GB10 bundle on the dev box (Git Bash): committed HEAD only + prebuilt ui/dist + manifest.
#   bash deploy/gb10/make_bundle.sh [outdir]       (default ../skillforge-gb10-bundle)
# Refuses a dirty tracked tree (except ui/tsconfig.tsbuildinfo, a build artifact). No secrets, no models, no
# node_modules, no data/ or results/ state: `git archive` takes only committed files.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
OUT=$(cd "${1:-$ROOT/..}" && pwd)/skillforge-gb10-bundle
[ -z "$(git status --porcelain --untracked-files=no | grep -v ' ui/tsconfig.tsbuildinfo$')" ] || { echo "dirty tracked tree: commit first"; exit 1; }
HEAD=$(git rev-parse HEAD); SHORT=$(git rev-parse --short HEAD)
rm -rf "$OUT"; mkdir -p "$OUT/src"
git archive HEAD | tar -x -C "$OUT/src"
rm -rf "$OUT/src/ui/screenshots" "$OUT/src/ui-experiments"   # review evidence / 3D spike: not needed to run, may show dev-box details
LEAK="$(hostname)|$(git config user.email || echo no-email-set)|C:\\\\?Users"   # this box's identifiers, read at run time
if grep -rIliE "$LEAK" "$OUT/src"; then echo "dev-box identifier found (files above)"; exit 1; fi
npm --prefix ui run -s build >/dev/null           # dist built AFTER the archive: newer than ui/src, so no rebuild on the GB10
cp -r ui/dist "$OUT/src/ui/dist"
cd "$OUT/src"
echo "$SHORT" > COMMIT
{ echo "commit $HEAD"; echo "branch $(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"; echo "built_utc $(date -u +%FT%TZ)";
  echo "contents: git archive of the commit + prebuilt ui/dist (npm run build at bundle time)";
  echo "excluded: models, HF caches, docker images (already on the SSD), node_modules, data/, results/, secrets"; } > MANIFEST.txt
find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
cd "$OUT"
tar -czf "skillforge-gb10-$SHORT.tar.gz" -C src .
sha256sum "skillforge-gb10-$SHORT.tar.gz" > "skillforge-gb10-$SHORT.tar.gz.sha256"
rm -rf src
echo "bundle: $OUT/skillforge-gb10-$SHORT.tar.gz"; cat "$OUT/skillforge-gb10-$SHORT.tar.gz.sha256"
