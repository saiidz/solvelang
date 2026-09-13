#!/usr/bin/env bash
set -Eeuo pipefail

tag="${1:-}"
expected_source_commit="${2:-}"

if [[ -z "$tag" ]]; then
  echo "usage: verify-release-tag-source.sh <annotated-version-tag> [expected-source-sha]" >&2
  exit 2
fi
if [[ -n "$expected_source_commit" && ! "$expected_source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "expected source commit must be a full lowercase Git SHA" >&2
  exit 2
fi
if ! git check-ref-format "refs/tags/$tag" >/dev/null 2>&1; then
  echo "release tag is not a valid Git tag name" >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "tagged release verification requires a clean worktree including untracked files" >&2
  exit 1
fi

tag_ref="refs/tags/$tag"
if ! git show-ref --verify --quiet "$tag_ref"; then
  echo "release tag does not exist locally: $tag" >&2
  exit 1
fi

object_type="$(git cat-file -t "$tag_ref")"
if [[ "$object_type" != "tag" ]]; then
  echo "release tag must be an annotated tag, not a lightweight tag" >&2
  exit 1
fi

tag_object="$(git rev-parse "$tag_ref")"
tag_commit="$(git rev-parse "$tag_ref^{commit}")"
head_commit="$(git rev-parse HEAD)"

if [[ ! "$tag_object" =~ ^[0-9a-f]{40}$ || ! "$tag_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "release tag identity must resolve to full lowercase Git SHAs" >&2
  exit 1
fi
if [[ "$head_commit" != "$tag_commit" ]]; then
  echo "checked-out HEAD does not match the annotated release tag commit" >&2
  exit 1
fi
if [[ -n "$expected_source_commit" && "$tag_commit" != "$expected_source_commit" ]]; then
  echo "annotated release tag commit does not match expected source commit" >&2
  exit 1
fi

version="$(python3 - "$repo_root/solvec/Cargo.toml" <<'PY'
from pathlib import Path
import re
import sys
import tomllib

path = Path(sys.argv[1])
with path.open("rb") as handle:
    data = tomllib.load(handle)
version = data.get("package", {}).get("version")
if not isinstance(version, str) or not re.fullmatch(
    r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?",
    version,
):
    raise SystemExit("solvec Cargo package version is missing or not semver-like")
print(version)
PY
)"

expected_tag="v$version"
if [[ "$tag" != "$expected_tag" ]]; then
  echo "release tag/version mismatch: expected $expected_tag for solvec $version" >&2
  exit 1
fi

python3 - "$tag" "$tag_object" "$tag_commit" "$version" <<'PY'
import json
import sys

tag, tag_object, source_commit, version = sys.argv[1:]
evidence = {
    "schema_version": "1.0.0",
    "kind": "solvelang_tagged_release_source",
    "publishable": False,
    "tag": tag,
    "tag_object": tag_object,
    "source_commit": source_commit,
    "version": version,
}
print(json.dumps(evidence, sort_keys=True, separators=(",", ":")))
PY
