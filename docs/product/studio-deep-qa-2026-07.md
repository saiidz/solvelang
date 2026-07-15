# Workflow Intelligence Studio Deep QA - July 2026

## Verdict

**Release recommended with known limitations.** This is an independent adversarial audit of Workflow Intelligence Studio v1. It does not describe the Studio as fully tested or production-ready.

- Tested baseline: `4691e7701918d9fbc070be7f79b6d8f9aa878151`
- Audit branch: `codex/studio-deep-qa-hardening`
- Baseline verdict: release blocked by reproducible S1 and S2 defects
- Final verdict: no known S0, S1, or S2 defect remains from this audit

## Environments

- Local static export: `http://127.0.0.1:4173/studio/`
- Live parity check: `https://www.solve-lang.com/studio/`
- Browsers: Playwright Chromium, Firefox, and WebKit
- Viewports: 390x844, 430x932, 768x1024, 900x1024, 1280x800, 1440x900, and 1920x1080
- Modes: keyboard-only, reduced motion, light preference, 200%-zoom-equivalent CSS viewport, and 6x CPU throttling
- Storage: fresh, valid, corrupt, quota-failing, and access-denied
- Stress documents: 50, 200, 500, and 1,000 nodes; focused dense cyclic graph with 1,000 nodes and 5,000 edges
- Tests made no external internet request. Live parity was a separate read-only check.

## Defects corrected

| ID | Severity | Reproduction and actual result | Root cause | Correction and regression proof |
| --- | --- | --- | --- | --- |
| SDQA-001 | S1 | Denied or quota-full storage could crash actions or report a save that did not happen. | `localStorage` reads and writes lacked complete exception boundaries. | Repository operations return explicit `ok`, `corrupt`, or `unavailable` status; focused denial and quota tests pass. |
| SDQA-002 | S1 | Imports accepted duplicate IDs and references to absent nodes, policies, or scenarios. | Shape validation did not enforce graph identity and reference integrity. | Strict schema refinements reject duplicates, broken references, unknown fields, unsafe keys, and excessive collection sizes. |
| SDQA-003 | S1 | A project name containing a newline could inject a new generated `.solve` line. | Draft comments and literals interpolated raw workflow text. | Draft generation uses line-safe comments and JSON-safe text; hostile export regression passes. |
| SDQA-004 | S1 | Renaming and immediately navigating away could lose the pending debounced edit. | Autosave had no synchronous lifecycle flush. | Pending changes flush on `pagehide`; cross-browser rename/reload persistence passes. |
| SDQA-005 | S1 | All five named templates loaded the support-triage graph. | Template factories changed labels but reused one domain model. | Each template now has domain-specific title, owners, systems, outputs, policy, and exception path; all parse successfully. |
| SDQA-006 | S1 | Path-depth analysis could grow exponentially on dense cyclic graphs. | It enumerated edge-simple paths. | Bounded iterative traversal replaces path enumeration; the 1,000-node/5,000-edge regression completes deterministically. |
| SDQA-007 | S2 | Markdown allowed raw HTML and CSV cells could begin with spreadsheet formulas. | Export encoding handled delimiters but not active-content semantics. | Markdown escapes HTML; CSV prefixes formula-leading cells; focused tests pass. |
| SDQA-008 | S2 | Project/scenario names produced traversal-like or control-character download names. | Filenames were derived without normalization. | Shared filename sanitizer produces bounded local names; browser download and hostile-name tests pass. |
| SDQA-009 | S2 | Corrupt version and trace arrays were trusted after only checking the array root. | Artifact members were not schema validated. | Version and trace schemas validate every member and quarantine malformed artifacts. |
| SDQA-010 | S2 | Corrupt project data was quarantined but could not be downloaded or reset as documented. | No recovery action was exposed. | The Projects view now offers `Download recovery data` and confirmed `Export & reset corrupt data`; repository recovery/reset tests pass. |
| SDQA-011 | S2 | Scenario input variables could not be edited and scenarios could not be deleted. | Scenario controls omitted those operations. | JSON input editing and explicit scenario deletion are available. |
| SDQA-012 | S2 | Edge label, condition, priority, and deletion were unavailable in the inspector. | Edge editing exposed only a subset of canonical fields. | Inspector provides all four controls and preserves canonical schema behavior. |
| SDQA-013 | S2 | Trace replay provided only previous/next controls. | Replay state had no timer or terminal controls. | Replay, pause, and end controls were added with bounded state cleanup. |
| SDQA-014 | S2 | Describe Workflow did not trap focus, close on Escape, or restore opener focus. | Dialog lifecycle behavior was incomplete. | Modal focus is trapped, Escape closes it, and focus returns to the opener; manual browser checks pass. |
| SDQA-015 | S2 | Clipboard rejection left the export action without useful status. | Promise rejection was unhandled. | Clipboard failure is caught and reports a download fallback. |
| SDQA-016 | S2 | A terminal reached exactly on step 200 was incorrectly marked as a safety-limit failure. | Limit evaluation happened before terminal completion. | Terminal completion precedes the limit check; exact-200 and over-200 tests pass. |
| SDQA-017 | S2 | Analytics counted scenarios without an expected terminal as matches and showed success before any run. | Missing expectations and empty result sets were folded into successful ratios. | Match denominators include only explicit expectations; no-run metrics remain neutral and bounded. |
| SDQA-018 | S2 | Serious axe color-contrast violations appeared in navigation and template numerals. | Muted foreground colors were too low contrast. | Tokens were adjusted; desktop and mobile axe runs report zero violations. |
| SDQA-019 | S2 | Activating the skip link changed the hash but did not place keyboard focus on the workspace. | The main target was not programmatically focusable. | The main landmark accepts focus; browser evidence records active element `studio-main`. |

Every defect above was first reproduced by source inspection, a focused failing test, or a browser failure. Corrections are covered by permanent Node tests where the behavior is pure and by repeatable browser evidence where it is interaction-specific.

## Functional and destructive coverage

- Created projects from every template; imported valid JSON; rejected malformed, incompatible, duplicate-ID, broken-reference, unknown-field, unsafe-key, and oversized documents without changing the active project.
- Edited project metadata, nodes, edges, policies, and scenarios; ran analysis and scenarios; inspected traces; replayed and compared results; created/restored versions; exported JSON, Markdown, CSV, evidence, and draft scripts.
- Verified delete cancellation, export-before-delete, active-project recovery, deletion of the last project, and reload into a usable blank project.
- Verified corrupt-data quarantine, recovery access, storage denial messaging, quota-safe writes, malformed artifact quarantine, and project artifact isolation.
- Validated all five generated template drafts with the Rust CLI. Drafts remain review-required and are not executed by Studio.

## Browser, accessibility, privacy, and performance evidence

- Chromium, Firefox, and WebKit completed create, edit, analyze, simulate, replay, export, reload, and persistence flows with zero console or page errors.
- All tested viewports had `scrollWidth == clientWidth`. Offscreen items in template, tab, and scenario rails remain intentionally reachable through their horizontal scroll containers.
- Axe reported zero violations on desktop and mobile reduced-motion/light-preference runs. Keyboard skip-link, dialog focus, Escape, focus restoration, and ordinary tab order were manually checked.
- Hostile HTML/script project names remained inert. Export hardening tests cover HTML, CSV formula, source-line, filename, prototype-key, and oversized-input cases.
- Runtime capture found no unexpected request in any local browser. The only Chromium failures were aborted same-origin Next prefetch `HEAD` requests to `/` and `/run/`; Firefox and WebKit had none. No workflow data was transmitted.
- Linear 1,000-node results: 649.31 ms project load, 206.29 ms canvas render, all 1,000 nodes present, 20.25 ms analysis, 20.77 ms analytics, 30.17 ms version snapshot, and 10.51 ms storage save in the measured local run.
- At 6x CPU throttling: 1,186.71 ms load and 246.44 ms canvas switch. The 640 CSS-pixel zoom equivalent had zero horizontal document overflow.

Raw local evidence and screenshots are retained outside the repository at `/private/tmp/solvelang-studio-qa-harness/evidence/` for this audit session, including `browser-audit.json`, `destructive.json`, `browser-modes.json`, `performance.json`, cross-browser screenshots, mobile, live, and zoom-equivalent captures.

## Validation

Baseline before production edits:

- `cd site && npm ci`: passed with the existing lockfile.
- `npm run test:studio`: 43 passed.
- `npm run lint`: passed.
- `npm run build`: passed; 13 static routes generated.
- `cd solvec && cargo fmt --check`: passed.
- `cargo clippy -- -D warnings`: passed.
- `cargo test`: 84 passed (15 unit, 69 CLI).
- `cargo build --release`: passed.

Final validation is recorded in the pull request after running the complete required command list from a clean dependency install.

## Known limitations

- Persistence is local to one browser profile and device, subject to browser storage capacity and clearing. Important workflows should be exported.
- The canvas renders all nodes and is not virtualized. The measured 1,000-node workflow remained usable in automated checks, but this is not a production-scale guarantee.
- Horizontal navigation/template/scenario rails intentionally scroll on narrow viewports; offscreen controls are not page overflow.
- The zoom check used a 640 CSS-pixel viewport as a deterministic 200%-equivalent layout test rather than browser UI zoom automation.
- Studio simulation remains deterministic modeling, not runtime execution or proof that an external integration will behave correctly.
