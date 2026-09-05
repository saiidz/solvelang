# Audited browser loader qualification

`solvec-wasm/browser/loader.mjs` is a client-only adapter for a reviewed qualification package. The caller must supply a trusted source commit and SHA-256 of the exact retained manifest from qualification evidence. Pins must not be derived from an untrusted fetched manifest or user input.

The loader restricts asset requests to the current origin, omits credentials, rejects redirects, limits fetch time and streamed bytes, verifies every file hash and the exact manifest file set, and checks WASM imports/exports before instantiation. Only verified glue bytes are imported through a temporary blob URL. A restrictive CSP may reject blob modules: this must remain a visible load failure, never a native/server fallback. The runtime exposes only the canonical bounded `run_pure_v1` string contract through `runPure`.

All load failures use `WASM_LOAD_FAILURE`, suitable for a visible alert. It never includes asset URLs, exception details or user source. Native solvec remains canonical; managed execution remains unavailable. Asset fetching does not grant network authority to Solve scripts.

The artifact-security build runs a real headless Chrome harness against a loopback-only server and a temporary browser profile, with external hostname resolution disabled. It qualifies shared fixtures, deny-before-output calls, resource bounds and visible missing/corrupt/oversized/mismatched package failures. Node tests cover server-side refusal and privacy-safe fetch failures. `CHROME_BIN` may select an installed browser; otherwise the harness uses Google Chrome on macOS or `google-chrome` on Linux. Missing browser tooling fails qualification, not to a substitute runtime.

## Static preview handoff

`site/app/run/wasmPreviewPin.json` pins the source revision and exact qualification manifest. The four retained package files live under the revision-specific `site/public/wasm/` directory. `/run/` loads the shared adapter only after Run is clicked, prevents duplicate runs, renders canonical diagnostics and permits retry after a load failure. The historical TypeScript preview is not an execution fallback.

The Node-only prebuild check verifies the exact file set, checksums, current artifact policy, import/export surface and byte limits. WASM CI additionally requires the pinned payload files to match a fresh audited build of current source. Next's bundler root includes the repository only to resolve the shared adapter; static export remains enabled and the production site build needs no Rust toolchain.

To update the pin, qualify the new source with the artifact-security workflow, review its retained package and provenance, then update the four assets and trusted pin together. Qualification-time manifest fields such as `publishable: false` and `browserPreviewReplaced: false` are immutable historical evidence, not deployment status or package-publication authorization. Do not rewrite them. A merge does not prove live deployment, authorize publication, or enable managed execution.
