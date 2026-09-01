#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <expected-source-sha> <target> <output-dir>" >&2
  exit 64
fi

EXPECTED_SHA="$1"
TARGET="$2"
OUTPUT_DIR="$3"

case "$TARGET" in
  x86_64-unknown-linux-gnu)
    OS_NAME="linux"
    ARCH_NAME="x86_64"
    BINARY_NAME="solvec"
    ;;
  *)
    echo "unsupported release-candidate target: $TARGET" >&2
    exit 64
    ;;
esac

ROOT="$(git rev-parse --show-toplevel)"
ACTUAL_SHA="$(git -C "$ROOT" rev-parse HEAD)"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "source SHA mismatch: expected $EXPECTED_SHA, got $ACTUAL_SHA" >&2
  exit 65
fi

VERSION="$(python3 - "$ROOT/solvec/Cargo.toml" <<'PY'
import pathlib
import sys
import tomllib

path = pathlib.Path(sys.argv[1])
with path.open("rb") as handle:
    document = tomllib.load(handle)
version = document.get("package", {}).get("version")
if not isinstance(version, str) or not version:
    raise SystemExit("missing solvec package version")
print(version)
PY
)"

SOURCE_DATE_EPOCH="$(git -C "$ROOT" show -s --format=%ct "$ACTUAL_SHA")"
ARTIFACT_BASENAME="solvelang-${VERSION}-${OS_NAME}-${ARCH_NAME}.tar.gz"
CHECKSUM_BASENAME="${ARTIFACT_BASENAME}.sha256"
PROVENANCE_BASENAME="${ARTIFACT_BASENAME}.provenance.json"

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

cp "$ROOT/solvec/target/$TARGET/release/$BINARY_NAME" "$STAGING_DIR/$BINARY_NAME"
chmod 0755 "$STAGING_DIR/$BINARY_NAME"

# Produce deterministic bytes for the same source commit + toolchain + target.
# GNU tar fixes file ordering/owner/group/time; gzip -n removes header name/time.
tar \
  --sort=name \
  --mtime="@${SOURCE_DATE_EPOCH}" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --mode='u+rwX,go+rX,go-w' \
  -C "$STAGING_DIR" \
  -cf - "$BINARY_NAME" \
  | gzip -n -9 > "$OUTPUT_DIR/$ARTIFACT_BASENAME"

(
  cd "$OUTPUT_DIR"
  sha256sum "$ARTIFACT_BASENAME" > "$CHECKSUM_BASENAME"
)

ARTIFACT_SHA256="$(cut -d' ' -f1 "$OUTPUT_DIR/$CHECKSUM_BASENAME")"
RUSTC_VERSION="$(rustc --version)"
CARGO_VERSION="$(cargo --version)"

python3 - \
  "$OUTPUT_DIR/$PROVENANCE_BASENAME" \
  "$VERSION" \
  "$TARGET" \
  "$OS_NAME" \
  "$ARCH_NAME" \
  "$ACTUAL_SHA" \
  "$SOURCE_DATE_EPOCH" \
  "$ARTIFACT_BASENAME" \
  "$ARTIFACT_SHA256" \
  "${GITHUB_WORKFLOW:-local}" \
  "${GITHUB_RUN_ID:-local}" \
  "${GITHUB_RUN_ATTEMPT:-local}" \
  "$RUSTC_VERSION" \
  "$CARGO_VERSION" <<'PY'
import json
import pathlib
import sys

(
    output,
    version,
    target,
    os_name,
    arch_name,
    source_sha,
    source_date_epoch,
    artifact,
    artifact_sha256,
    workflow,
    run_id,
    run_attempt,
    rustc_version,
    cargo_version,
) = sys.argv[1:]

payload = {
    "schema_version": 1,
    "release_kind": "candidate-dry-run",
    "publishable": False,
    "version": version,
    "target": target,
    "os": os_name,
    "arch": arch_name,
    "source_sha": source_sha,
    "source_date_epoch": int(source_date_epoch),
    "artifact": artifact,
    "artifact_sha256": artifact_sha256,
    "workflow": workflow,
    "run_id": run_id,
    "run_attempt": run_attempt,
    "rustc": rustc_version,
    "cargo": cargo_version,
}
pathlib.Path(output).write_text(
    json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n",
    encoding="utf-8",
)
PY

printf 'version=%s\n' "$VERSION"
printf 'artifact=%s\n' "$ARTIFACT_BASENAME"
printf 'checksum=%s\n' "$CHECKSUM_BASENAME"
printf 'provenance=%s\n' "$PROVENANCE_BASENAME"
printf 'source_sha=%s\n' "$ACTUAL_SHA"
