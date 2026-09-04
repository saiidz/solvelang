#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "release candidate build requires a clean worktree including untracked files" >&2
  exit 1
fi

source_commit="${SOLVELANG_SOURCE_COMMIT:-$(git rev-parse HEAD)}"
if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "SOLVELANG_SOURCE_COMMIT must be a full 40-character lowercase Git SHA" >&2
  exit 1
fi

actual_commit="$(git rev-parse HEAD)"
if [[ "$actual_commit" != "$source_commit" ]]; then
  echo "release candidate source mismatch: expected $source_commit, checked out $actual_commit" >&2
  exit 1
fi

target="${SOLVELANG_RELEASE_TARGET:-x86_64-unknown-linux-gnu}"
case "$target" in
  x86_64-unknown-linux-gnu)
    target_os="linux"
    target_arch="x86_64"
    source_binary="$repo_root/solvec/target/$target/release/solvec"
    binary_name="solvec"
    ;;
  *)
    echo "unsupported release-candidate target: $target" >&2
    exit 1
    ;;
esac

dist_dir="${SOLVELANG_RELEASE_DIST:-$repo_root/dist/release-candidate}"
if [[ -e "$dist_dir" || -L "$dist_dir" ]]; then
  echo "release candidate destination must not exist; use a fresh directory" >&2
  exit 1
fi
# Never replace previous evidence; fail closed on concurrent creation too.
mkdir -p "$(dirname "$dist_dir")"
mkdir "$dist_dir"

version="$({ cd solvec; cargo metadata --locked --no-deps --format-version 1; } | python3 -c 'import json,sys; data=json.load(sys.stdin); print(next(p["version"] for p in data["packages"] if p["name"] == "solvec"))')"
artifact_name="solvelang-${version}-${target_os}-${target_arch}.tar.gz"

(
  cd solvec
  cargo build --release --locked --target "$target"
)

if [[ ! -f "$source_binary" || ! -x "$source_binary" ]]; then
  echo "release binary is missing or not executable: $source_binary" >&2
  exit 1
fi

source_date_epoch="$(git show -s --format=%ct "$source_commit")"
staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT
cp "$source_binary" "$staging_dir/$binary_name"
chmod 0755 "$staging_dir/$binary_name"

tar \
  --sort=name \
  --mtime="@${source_date_epoch}" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --mode='u+rwX,go+rX,go-w' \
  -C "$staging_dir" \
  -cf - "$binary_name" \
  | gzip -n -9 > "$dist_dir/$artifact_name"

python3 - "$dist_dir/$artifact_name" "$dist_dir/SHA256SUMS" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys

artifact = Path(sys.argv[1])
checksum_file = Path(sys.argv[2])
digest = sha256(artifact.read_bytes()).hexdigest()
checksum_file.write_text(f"{digest}  {artifact.name}\n", encoding="utf-8")
PY

rustc_version="$(rustc --version)"
cargo_version="$(cargo --version)"
python3 - \
  "$dist_dir" \
  "$artifact_name" \
  "$version" \
  "$target" \
  "$target_os" \
  "$target_arch" \
  "$source_commit" \
  "$source_date_epoch" \
  "$rustc_version" \
  "$cargo_version" <<'PY'
from hashlib import sha256
from pathlib import Path
import json
import os
import sys

(
    dist,
    artifact_name,
    version,
    target,
    target_os,
    target_arch,
    source_commit,
    source_date_epoch,
    rustc_version,
    cargo_version,
) = sys.argv[1:]
out = Path(dist)
artifact = out / artifact_name
provenance = {
    "schema_version": "1.0.0",
    "kind": "solvelang_release_candidate",
    "publishable": False,
    "version": version,
    "source_commit": source_commit,
    "source_date_epoch": int(source_date_epoch),
    "target": target,
    "os": target_os,
    "arch": target_arch,
    "artifact": artifact_name,
    "sha256": sha256(artifact.read_bytes()).hexdigest(),
    "rustc": rustc_version,
    "cargo": cargo_version,
    "workflow": {
        "repository": os.environ.get("GITHUB_REPOSITORY"),
        "name": os.environ.get("GITHUB_WORKFLOW"),
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
    },
}
(out / "provenance.json").write_text(
    json.dumps(provenance, sort_keys=True, separators=(",", ":")) + "\n",
    encoding="utf-8",
)
PY

"$repo_root/solvec/scripts/verify-release-candidate.sh" "$dist_dir" "$source_commit"
echo "release candidate dry run complete: $dist_dir"
