// Sample receipt input: a real public PR read live for this service.
// espanso/espanso PR #2511, read 2026-11-24 ~09:40 EST via `gh api`
// (authenticated as saiidz) against api.github.com. The PR Gate route
// record below is the real outcome of the report-only run attempted the
// same morning: it failed operationally on a vendored zip entry, so the
// route is recorded as failed — never silently dropped.
import type { ChangeImpactReceiptInput } from "./receipt";

export const sampleReceiptInput: ChangeImpactReceiptInput = {
  pr: {
    owner: "espanso",
    repo: "espanso",
    number: 2511,
    title: "Fix Cmd+Enter not submitting forms on macOS (#2457)",
    url: "https://github.com/espanso/espanso/pull/2511",
    state: "open",
    draft: false,
    author: "gcailly",
    createdAt: "2025-10-06T07:06:54Z",
    updatedAt: "2026-07-18T19:13:29Z",
    headSha: "5e9ad01306f0d1fc2ad1d8f6e37300f00c2e1eaf",
    headRef: "fix-macos-cmd-enter-form-2457",
    baseRef: "dev",
    baseSha: "f239adb273f9367dc65a12c38421f27485ebcc1f",
    mergeable: true,
    mergeableState: "unstable",
    changedFiles: 2,
    additions: 6,
    deletions: 1,
    commits: 7,
  },
  files: [
    { filename: ".vscode/tasks.json", status: "modified", additions: 1, deletions: 0 },
    { filename: "espanso-modulo/src/sys/form/form.cpp", status: "modified", additions: 5, deletions: 1 },
  ],
  checkRuns: [
    { name: "linux-x11", status: "completed", conclusion: "cancelled" },
    { name: "linux-wayland", status: "completed", conclusion: "cancelled" },
    { name: "macos", status: "completed", conclusion: "cancelled" },
    { name: "windows", status: "completed", conclusion: "cancelled" },
  ],
  reviews: [
    { author: "AucaCoyan", state: "CHANGES_REQUESTED" },
    { author: "AucaCoyan", state: "APPROVED" },
  ],
  compare: { status: "diverged", aheadBy: 7, behindBy: 35 },
  prGate: {
    status: "failed",
    error: "PR Gate run exited with an operational error: \"File entry is missing Uint8Array content: espanso-modulo/vendor/wxWidgets-3.1.5-patched-version-3.zip\".",
    provenance: "SolveLang PR Gate CLI (packages/pr-gate, report-only mode) run 2026-11-24 ~09:42 EST against a depth-1 checkout verified at head 5e9ad01306f0d1fc2ad1d8f6e37300f00c2e1eaf.",
  },
  readAt: "2026-11-24 ~09:40 EST",
  source: "GitHub REST API via gh api (authenticated as saiidz)",
};
