#!/usr/bin/env bash
set -euo pipefail

dist_dir="${1:-}"
if [[ -z "$dist_dir" || ! -d "$dist_dir" ]]; then
  echo "usage: verify-release-candidate.sh <dist-directory>" >&2
  exit 2
fi

python3 - "$dist_dir" <<'PY'
from hashlib import sha256
from pathlib import Path
import json
import re
import sys

out = Path(sys.argv[1])
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
if not re.fullmatch(r"[0-9a-f]{40}", provenance.get("source_commit", "")):
    raise SystemExit("provenance source_commit must be a full lowercase Git SHA")

artifact_name = provenance.get("artifact", "")
artifact = out / artifact_name
if not artifact_name or Path(artifact_name).name != artifact_name or not artifact.is_file():
    raise SystemExit("provenance artifact must name one file in the candidate directory")

expected_digest = sha256(artifact.read_bytes()).hexdigest()
if provenance.get("sha256") != expected_digest:
    raise SystemExit("provenance digest does not match artifact")

checksum_lines = [line for line in checksums_path.read_text(encoding="utf-8").splitlines() if line]
if checksum_lines != [f"{expected_digest}  {artifact_name}"]:
    raise SystemExit("SHA256SUMS must contain exactly the candidate artifact digest")

expected_prefix = f"solvec-v{provenance.get('version', '')}-{provenance.get('target', '')}"
if artifact_name not in {expected_prefix, expected_prefix + ".exe"}:
    raise SystemExit("artifact name does not match version and target provenance")

extra = sorted(p.name for p in out.iterdir() if p.name not in {artifact_name, "SHA256SUMS", "provenance.json"})
if extra:
    raise SystemExit(f"unexpected release-candidate files: {extra}")
PY

artifact="$(python3 - "$dist_dir/provenance.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["artifact"])
PY
)"
"$dist_dir/$artifact" --help >/dev/null
