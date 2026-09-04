#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
test -z "$(git status --porcelain --untracked-files=all)"
source_commit="$(git rev-parse HEAD)"
test "$(node -p 'process.versions.node.split(".")[0]')" = "24"
test "$(rustc +1.95.0 --version | cut -d ' ' -f 2)" = "1.95.0"
test "$(wasm-bindgen --version)" = "wasm-bindgen 0.2.127"
audit_root="$(mktemp -d)"
evidence_root="$repo_root/solvec-wasm/target/artifact-security-evidence"
# Only tracked commit contents become compiler inputs. Ignored build.rs/config
# files in the caller checkout are never copied into this isolated snapshot.
mkdir "$audit_root/source"
if git ls-tree -r "$source_commit" | awk '$1 == "120000" { found=1 } END { exit !found }'; then
  echo "audited source snapshot must not contain symlinks" >&2
  exit 1
fi
git archive "$source_commit" | tar -x -C "$audit_root/source"
repo_root="$audit_root/source"
cd "$repo_root"
compiler="$(rustup which --toolchain 1.95.0 rustc)"
compiler_host="$("$compiler" -vV | sed -n 's/^host: //p')"
linker="$("$compiler" --print sysroot)/lib/rustlib/$compiler_host/bin/rust-lld"
test -x "$linker"
for attempt in first second; do
  env -u RUSTC -u RUSTC_WRAPPER -u RUSTC_WORKSPACE_WRAPPER -u RUSTC_BOOTSTRAP \
    -u RUSTFLAGS \
    CARGO_BUILD_RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER= \
    CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="$audit_root/$attempt/target" \
    CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=$repo_root=/solvelang" \
    CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER="$linker" \
    cargo +1.95.0 --config "build.rustc=\"$compiler\"" \
      --config 'build.rustc-wrapper=""' --config 'build.rustc-workspace-wrapper=""' \
      --config "target.wasm32-unknown-unknown.linker=\"$linker\"" \
      build --manifest-path solvec-wasm/Cargo.toml --release --locked --target wasm32-unknown-unknown
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
mkdir -p "$evidence_root"
cp "$audit_root/first/audit.json" "$evidence_root/audit.json"
printf 'Two clean pinned builds are byte-identical. Evidence: solvec-wasm/target/artifact-security-evidence/audit.json\n'
