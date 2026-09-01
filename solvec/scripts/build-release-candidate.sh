#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "release candidate build requires a clean tracked worktree" >&2
  exit 1
fi

source_commit="${SOLVELANG_SOURCE_COMMIT:-$(git rev-parse HEAD)}"
if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "SOLVELANG_SOURCE_COMMIT must be a full 40-character lowercase Git SHA" >&2
  exit 1
fi

version="$({ cd solvec; cargo metadata --locked --no-deps --format-version 1; } | python3 -c 'import json,sys; data=json.load(sys.stdin); print(next(p["version"] for p in data["packages"] if p["name"] == "solvec"))')"
host_triple="$(rustc -vV | awk '/^host: / { print $2 }')"
if [[ -z "$host_triple" ]]; then
  echo "could not determine Rust host triple" >&2
  exit 1
fi

artifact_name="solvec-v${version}-${host_triple}"
if [[ "$host_triple" == *windows* ]]; then
  artifact_name+=".exe"
  source_binary="$repo_root/solvec/target/release/solvec.exe"
else
  source_binary="$repo_root/solvec/target/release/solvec"
fi

dist_dir="${SOLVELANG_RELEASE_DIST:-$repo_root/dist/release-candidate}"
rm -rf "$dist_dir"
mkdir -p "$dist_dir"

(
  cd solvec
  cargo build --release --locked
)

cp "$source_binary" "$dist_dir/$artifact_name"
if [[ "$artifact_name" != *.exe ]]; then
  chmod 0755 "$dist_dir/$artifact_name"
fi

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
python3 - "$dist_dir" "$artifact_name" "$version" "$host_triple" "$source_commit" "$rustc_version" "$cargo_version" <<'PY'
from hashlib import sha256
from pathlib import Path
import json
import os
import sys

out = Path(sys.argv[1])
artifact_name, version, target, source_commit, rustc_version, cargo_version = sys.argv[2:]
artifact = out / artifact_name
provenance = {
    "schema_version": "1.0.0",
    "kind": "solvelang_release_candidate",
    "publishable": False,
    "version": version,
    "source_commit": source_commit,
    "target": target,
    "artifact": artifact_name,
    "sha256": sha256(artifact.read_bytes()).hexdigest(),
    "rustc": rustc_version,
    "cargo": cargo_version,
    "workflow": {
        "repository": os.environ.get("GITHUB_REPOSITORY"),
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
    },
}
(out / "provenance.json").write_text(
    json.dumps(provenance, sort_keys=True, indent=2) + "\n",
    encoding="utf-8",
)
PY

"$repo_root/solvec/scripts/verify-release-candidate.sh" "$dist_dir"
echo "release candidate dry run complete: $dist_dir"
