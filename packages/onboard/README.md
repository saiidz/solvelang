# SolveLang Onboard

One command that onboards an existing repository to SolveLang — no
hand-written `.solve` files for routine tasks.

```bash
solvelang-onboard [targetDir] [--out <dir>] [--budget-bytes <n>]
```

`targetDir` defaults to the current directory; output defaults to
`<targetDir>/.solve/`. Exit codes: `0` done, `2` operational error.

## What it generates

| Output | What it is |
| --- | --- |
| `.solve/workflows/context-pack.solve` | Starter workflow: build a Solve Context pack before changing code. Always generated. |
| `.solve/workflows/validate.solve` | Verification workflow. Names the repository's own test command when one was discovered; when none was, it says so and asks a human instead of inventing a command. |
| `.solve/workflows/change-review.solve` | Review workflow over the context pack, with the repo's most-changed paths named when history provided them. |
| `.solve/workflows/ci-triage.solve` | CI-failure triage workflow. Generated only when a test or build command signal exists. |
| `.solve/context-pack.json` | An initial Solve Context pack for the repository, built by the existing pack machinery (`buildWorkspaceContextPack` in `packages/mcp-server`) — this package does not write its own pack format. |
| `.solve/onboard-report.md` | The inference report: every signal read, every generated file, and the source each block came from. |

## Signals it reads

- **Guidance files** — `AGENTS.md` and `CLAUDE.md` at the repository root.
  Commands are extracted only when they appear as a backticked command
  (or a labelled "test/build/lint/run command:" line) and can be
  classified by the surrounding heading or wording. Every command fact
  keeps its `file:line` source.
- **Manifests** — `package.json` scripts (`test`, `build`, `lint`,
  `start`, `dev`), attributed to `package.json:scripts.<name>`.
- **Git history** — a bounded read: commit count, the subjects of the
  most recent 50 commits, and the most frequently changed paths in that
  window (only paths changed at least twice are reported).
- **Layout** — a bounded inventory walk (at most 4,000 entries, depth
  12; `.git`, `node_modules`, `dist`, `target`, and similar directories
  skipped). Ecosystem markers (`package.json`, `pyproject.toml`,
  `Cargo.toml`, `composer.json`, `go.mod`, …), language tallies by
  extension, and per-file classification from the repository-audit
  inventory classifier.

## Honesty rules — what it will not infer

- A command that is not stated in a guidance file or a manifest does
  not appear anywhere in the output.
- An unclassifiable command (its kind cannot be told from context) is
  dropped, not guessed at.
- No deployment, hosting, or release workflow is ever generated: this
  tool found no honest signal for one, so it does not produce one.
- When history or guidance is unavailable, the report says so plainly
  and the affected workflows stay generic rather than specific-sounding.
- The MCP server is untouched: it stays read-only by contract. This
  package is a separate writer tool, in the same Node package pattern
  as `packages/pr-gate`.

## Development

```bash
npm ci
npm test   # builds, then runs the fixture suite (JS+AGENTS.md, Python+CLAUDE.md, bare repo)
```

Generated `.solve` files use only constructs from the repository's own
`examples/`. The fixture suite validates them with the real `solvec`
when a binary is available (`SOLVEC_BIN`); the `onboard-ci` workflow
builds `solvec` and sets `SOLVEC_BIN`, so validation always runs in CI.
