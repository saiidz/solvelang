#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
test -z "$(git status --porcelain --untracked-files=all)"
source_commit="$(git rev-parse HEAD)"
test "$(node -p 'process.versions.node.split(".")[0]')" = "24"
test "$(rustc +1.95.0 --version | cut -d ' ' -f 2)" = "1.95.0"
test "$(wasm-bindgen --version)" = "wasm-bindgen 0.2.127"
# Cargo metadata includes build paths: qualification uses one exclusive, stable
# path per host. Never delete or reuse a pre-existing caller directory.
audit_root="/tmp/solvelang-wasm-audit-v1"
mkdir "$audit_root"
trap 'rm -rf "$audit_root"' EXIT
audit_root="$(cd "$audit_root" && pwd -P)"
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
linker="$("$compiler" --print sysroot)/lib/rustlib/$("$compiler" -vV | sed -n 's/^host: //p')/bin/rust-lld"
test -x "$linker"

# Caller/user Cargo configuration is not part of the audited source commit and
# therefore must not influence dependency resolution or the compiled evidence.
# Remove every inherited Cargo/Rust compiler override, then give Cargo a fresh
# private HOME/CARGO_HOME. Repository-local tracked .cargo configuration, if
# present in the archived commit, remains reviewable input.
while IFS='=' read -r name _; do
  case "$name" in
    CARGO_*|RUSTC|RUSTC_*|RUSTFLAGS|RUSTDOCFLAGS)
      unset "$name"
      ;;
  esac
done < <(env)
cargo_bin="$(rustup which --toolchain 1.95.0 cargo)"
test -x "$cargo_bin"

for attempt in first second; do
  attempt_root="$audit_root/work"
  rm -rf "$attempt_root"
  audit_home="$attempt_root/home"
  audit_cargo_home="$attempt_root/cargo-home"
  mkdir -p "$audit_home" "$audit_cargo_home"
  cp -R "$repo_root" "$attempt_root/source"
  cd "$attempt_root/source"
  HOME="$audit_home" CARGO_HOME="$audit_cargo_home" \
    CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="$attempt_root/target" \
    CARGO_BUILD_RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER= \
    CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=$attempt_root/source=/solvelang" \
    CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER="$linker" \
    "$cargo_bin" --config "build.rustc=\"$compiler\"" \
      --config 'build.rustc-wrapper=""' --config 'build.rustc-workspace-wrapper=""' \
      --config "target.wasm32-unknown-unknown.linker=\"$linker\"" \
      build --manifest-path solvec-wasm/Cargo.toml --release --locked --target wasm32-unknown-unknown
  wasm-bindgen --target bundler --no-typescript --out-dir "$audit_root/$attempt/bundle" \
    "$attempt_root/target/wasm32-unknown-unknown/release/solvec_wasm.wasm"
  node solvec-wasm/qa/audit-artifact.cjs "$audit_root/$attempt/bundle" "$source_commit" > "$audit_root/$attempt/audit.json"
  cd "$repo_root"
done
cd "$repo_root"
cmp "$audit_root/first/audit.json" "$audit_root/second/audit.json"
for artifact in solvec_wasm.js solvec_wasm_bg.js solvec_wasm_bg.wasm; do
  cmp "$audit_root/first/bundle/$artifact" "$audit_root/second/bundle/$artifact"
done
SOLVELANG_WASM_AUDIT_DIR="$audit_root/first/bundle" node --test solvec-wasm/qa/audit-artifact.test.cjs
node solvec-wasm/qa/browser-artifact-conformance.mjs "$audit_root/first/bundle" "$source_commit"
SOLVELANG_WASM_AUDIT_DIR="$audit_root/first/bundle" SOLVELANG_WASM_SOURCE_COMMIT="$source_commit" \
  node --test solvec-wasm/qa/package-artifact.test.cjs
node solvec-wasm/qa/package-artifact.cjs "$audit_root/first/bundle" "$audit_root/qualified-package" "$source_commit"
node --test solvec-wasm/qa/browser-loader.test.mjs
node solvec-wasm/qa/browser-loader-conformance.mjs "$audit_root/qualified-package" "$source_commit"
mkdir -p "$evidence_root"
cp "$audit_root/first/audit.json" "$evidence_root/audit.json"
node solvec-wasm/qa/package-artifact.cjs --retain "$audit_root/qualified-package" "$evidence_root/package" "$source_commit"
printf 'Two clean pinned builds are byte-identical. Evidence: solvec-wasm/target/artifact-security-evidence/audit.json\n'
