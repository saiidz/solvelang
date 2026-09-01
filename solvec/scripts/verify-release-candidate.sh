#!/usr/bin/env bash
set -Eeuo pipefail

dist_dir="${1:-}"
expected_source_commit="${2:-}"
if [[ -z "$dist_dir" || ! -d "$dist_dir" ]]; then
  echo "usage: verify-release-candidate.sh <dist-directory> [expected-source-sha]" >&2
  exit 2
fi
if [[ -n "$expected_source_commit" && ! "$expected_source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "expected source commit must be a full lowercase Git SHA" >&2
  exit 2
fi

python3 - "$dist_dir" "$expected_source_commit" <<'PY'
from hashlib import sha256
from pathlib import Path
import json
import re
import sys

out = Path(sys.argv[1])
expected_source_commit = sys.argv[2]
provenance_path = out / "provenance.json"
checksums_path = out / "SHA256SUMS"
if not provenance_path.is_file() or not checksums_path.is_file():
    raise SystemExit("candidate must contain provenance.json and SHA256SUMS")

provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
if provenance.get("schema_version") != "1.0.0":
    raise SystemExit("unsupported provenance schema")
if provenance.get("kind") != "solvelang_release_candidate":
    raise SystemExit("unexpected provenance kind")
if provenance.get("publishable") is not False:
    raise SystemExit("pre-tag candidate must be explicitly non-publishable")
source_commit = provenance.get("source_commit", "")
if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
    raise SystemExit("provenance source_commit must be a full lowercase Git SHA")
if expected_source_commit and source_commit != expected_source_commit:
    raise SystemExit("provenance source_commit does not match the expected checkout")
if not isinstance(provenance.get("source_date_epoch"), int) or provenance["source_date_epoch"] <= 0:
    raise SystemExit("provenance source_date_epoch must be a positive integer")

if provenance.get("target") != "x86_64-unknown-linux-gnu":
    raise SystemExit("current release-candidate contract supports only Linux x86_64")
if provenance.get("os") != "linux" or provenance.get("arch") != "x86_64":
    raise SystemExit("normalized release-candidate platform does not match target")

version = provenance.get("version", "")
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?", version):
    raise SystemExit("provenance version is not semver-like")
artifact_name = provenance.get("artifact", "")
expected_name = f"solvelang-{version}-linux-x86_64.tar.gz"
if artifact_name != expected_name:
    raise SystemExit("artifact name does not contain the declared version/OS/architecture/archive type")
artifact = out / artifact_name
if not artifact.is_file():
    raise SystemExit("provenance artifact is missing")

expected_digest = sha256(artifact.read_bytes()).hexdigest()
if provenance.get("sha256") != expected_digest:
    raise SystemExit("provenance digest does not match artifact")

checksum_lines = [line for line in checksums_path.read_text(encoding="utf-8").splitlines() if line]
if checksum_lines != [f"{expected_digest}  {artifact_name}"]:
    raise SystemExit("SHA256SUMS must contain exactly the candidate archive digest")

workflow = provenance.get("workflow")
if not isinstance(workflow, dict):
    raise SystemExit("provenance workflow identity must be an object")

extra = sorted(p.name for p in out.iterdir() if p.name not in {artifact_name, "SHA256SUMS", "provenance.json"})
if extra:
    raise SystemExit(f"unexpected release-candidate files: {extra}")
PY

artifact="$(python3 - "$dist_dir/provenance.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["artifact"])
PY
)"
smoke_dir="$(mktemp -d)"
trap 'rm -rf "$smoke_dir"' EXIT
tar -xzf "$dist_dir/$artifact" -C "$smoke_dir"
if [[ ! -x "$smoke_dir/solvec" ]]; then
  echo "candidate archive does not contain executable solvec" >&2
  exit 1
fi
"$smoke_dir/solvec" help >/dev/null
