#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
git diff --quiet HEAD -- solvec-core solvec-wasm conformance
source_commit="$(git rev-parse HEAD)"
test "$(rustc +1.95.0 --version | cut -d ' ' -f 2)" = "1.95.0"
test "$(wasm-bindgen --version)" = "wasm-bindgen 0.2.127"
audit_root="$(mktemp -d)"
for attempt in first second; do
  CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="$audit_root/$attempt/target" \
    RUSTFLAGS="--remap-path-prefix=$repo_root=/solvelang" \
    cargo +1.95.0 build --manifest-path solvec-wasm/Cargo.toml --release --locked --target wasm32-unknown-unknown
  wasm-bindgen --target bundler --no-typescript --out-dir "$audit_root/$attempt/bundle" \
    "$audit_root/$attempt/target/wasm32-unknown-unknown/release/solvec_wasm.wasm"
  node solvec-wasm/qa/audit-artifact.cjs "$audit_root/$attempt/bundle" "$source_commit" > "$audit_root/$attempt/audit.json"
done
cmp "$audit_root/first/audit.json" "$audit_root/second/audit.json"
for artifact in solvec_wasm.js solvec_wasm_bg.js solvec_wasm_bg.wasm; do
  cmp "$audit_root/first/bundle/$artifact" "$audit_root/second/bundle/$artifact"
done
SOLVELANG_WASM_AUDIT_DIR="$audit_root/first/bundle" node --test solvec-wasm/qa/audit-artifact.test.cjs
node solvec-wasm/qa/browser-artifact-conformance.mjs "$audit_root/first/bundle" "$source_commit"
mkdir -p solvec-wasm/target/artifact-security-evidence
cp "$audit_root/first/audit.json" solvec-wasm/target/artifact-security-evidence/audit.json
printf 'Two clean pinned builds are byte-identical. Evidence: solvec-wasm/target/artifact-security-evidence/audit.json\n'
