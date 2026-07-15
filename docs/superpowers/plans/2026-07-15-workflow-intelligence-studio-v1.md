# Workflow Intelligence Studio v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a connected local-first Studio for workflow modeling, deterministic analysis, scenario simulation, traces, analytics, versioning, and evidence export.

**Architecture:** Pure TypeScript core modules own the canonical IR and deterministic computations. A client-only React application renders a dependency-free graph/list editor and persists projects through a versioned local repository. Next.js remains statically exported; no Studio module performs network I/O.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod 4, CSS Modules, Node built-in test runner, browser localStorage and Blob APIs.

---

### Task 1: Workflow IR, schemas, templates, and fixtures

**Files:**
- Create: `site/app/studio/core/types.ts`
- Create: `site/app/studio/core/schema.ts`
- Create: `site/app/studio/core/templates.ts`
- Create: `site/app/studio/core/fixtures.ts`
- Test: `site/app/studio/core/schema.test.ts`

- [ ] Write tests that reject malformed node types and accept support, lead, intake, invoice, and incident templates.
- [ ] Run `npm run test:studio` and confirm missing-module failures.
- [ ] Define the complete typed IR, Zod schemas, deterministic ID helper, templates, and required fixtures.
- [ ] Run the focused tests and confirm schema and template assertions pass.

### Task 2: Graph integrity and 25-rule analysis engine

**Files:**
- Create: `site/app/studio/core/graph.ts`
- Create: `site/app/studio/core/analysis.ts`
- Test: `site/app/studio/core/analysis.test.ts`

- [ ] Add one table-driven failing assertion for each rule ID `SL001` through `SL025` plus passed-check output.
- [ ] Run the tests and verify failures identify missing analysis exports.
- [ ] Implement graph indexes, reachability, cycles, coverage factors, finding construction, suppression, and documented readiness scoring.
- [ ] Run tests and confirm every rule and score factor passes.

### Task 3: Deterministic simulator, traces, and comparison

**Files:**
- Create: `site/app/studio/core/simulation.ts`
- Create: `site/app/studio/core/comparison.ts`
- Test: `site/app/studio/core/simulation.test.ts`

- [ ] Add failing tests for happy path, fallback, unresolved decision, human pause, policy check, cycle guard, trace order, and scenario differences.
- [ ] Implement priority-ordered traversal with a 200-step guard and typed trace events.
- [ ] Implement deterministic path, owner, decision, review, SLA, risk, output, and terminal comparisons.
- [ ] Run tests and confirm all simulation and comparison cases pass without internet.

### Task 4: Workflow and scenario analytics

**Files:**
- Create: `site/app/studio/core/analytics.ts`
- Test: `site/app/studio/core/analytics.test.ts`

- [ ] Add failing tests for every required structural and scenario metric and all five quality scores.
- [ ] Implement graph depth, coverage, handoff, traversal-frequency, cycle-time, failure-distribution, and score-factor calculations.
- [ ] Ensure scores are rounded integers with factor lists rather than misleading decimals.
- [ ] Run analytics tests and confirm deterministic results.

### Task 5: Persistence, versions, migration, and local product events

**Files:**
- Create: `site/app/studio/core/storage.ts`
- Create: `site/app/studio/core/versions.ts`
- Create: `site/app/studio/core/productAnalytics.ts`
- Test: `site/app/studio/core/storage.test.ts`

- [ ] Add failing in-memory Storage-like tests for project CRUD, migration, corrupt quarantine, deduplicated versions, restore, comparison, and aggregate counters.
- [ ] Implement schema-versioned storage interfaces without direct global access in pure functions.
- [ ] Add browser adapters only at the application boundary.
- [ ] Run tests and confirm incompatible data is never overwritten silently.

### Task 6: Evidence exports

**Files:**
- Create: `site/app/studio/core/exports.ts`
- Test: `site/app/studio/core/exports.test.ts`

- [ ] Add failing tests for canonical JSON round trip, findings JSON, analytics CSV/JSON, trace JSON, Markdown, printable HTML, and generated draft labels/comments.
- [ ] Implement pure serializers and browser download/copy helpers separately.
- [ ] Run tests and confirm generated drafts preserve policy and human-review intent.

### Task 7: Studio application shell and graph editor

**Files:**
- Create: `site/app/studio/page.tsx`
- Create: `site/app/studio/StudioApp.tsx`
- Create: `site/app/studio/studio.module.css`
- Create: `site/app/studio/components/WorkflowCanvas.tsx`
- Create: `site/app/studio/components/WorkflowWizard.tsx`
- Create: `site/app/studio/components/Inspector.tsx`

- [ ] Build the static route metadata and client shell with skip link, landmarks, status live region, project rail, tabs, inspector, and trace panel.
- [ ] Implement template/blank/import/wizard entry flows and local autosave.
- [ ] Implement SVG edges, DOM nodes, zoom, pan, fit, keyboard selection/movement, add, duplicate, delete, connect, and edge-condition editing.
- [ ] Implement the mobile node-list editor with equivalent actions.
- [ ] Run lint/build and resolve all accessibility and type failures.

### Task 8: Analysis, scenario, trace, analytics, versions, and export views

**Files:**
- Create: `site/app/studio/components/AnalysisPanel.tsx`
- Create: `site/app/studio/components/ScenarioLab.tsx`
- Create: `site/app/studio/components/TracePanel.tsx`
- Create: `site/app/studio/components/AnalyticsPanel.tsx`
- Create: `site/app/studio/components/VersionsPanel.tsx`
- Create: `site/app/studio/components/ExportPanel.tsx`

- [ ] Connect every view to the pure core modules and local project state.
- [ ] Add finding navigation/suppression, scenario duplication/edit/run/compare, trace replay/jump/download, score formulas, version compare/restore confirmation, and all export actions.
- [ ] Confirm controls produce real state changes and no view contains fake metrics or integrations.
- [ ] Run lint/build after each connected view group.

### Task 9: Documentation, homepage/resources integration, and Linear plan

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `docs/language-reference.md`
- Create: `docs/product/workflow-analysis-rules.md`
- Create: `docs/product/workflow-analytics.md`
- Create: `docs/product/studio-privacy.md`
- Create: `docs/product/linear-workflow-intelligence-studio-v1.md`
- Modify: `site/app/landing/page.tsx`
- Modify: `site/app/resources/page.tsx`
- Modify: `site/public/llms.txt`

- [ ] Document the deterministic/local boundary, rule formulas, analytics formulas, privacy, draft status, and Rust CLI authority.
- [ ] Add the Studio as the homepage primary action without undoing the positioning rebuild.
- [ ] Add Studio resources and the exact fallback Linear milestones/issues with dependencies and acceptance criteria.
- [ ] Run `git diff --check` and inspect copy for unsupported claims.

### Task 10: Full validation, browser review, commits, and PR

**Files:**
- Modify only files required to resolve validation defects.

- [ ] Run `npm ci`, `npm run test:studio`, `npm run lint`, and `npm run build` from `site/`.
- [ ] Confirm all required static HTML files exist, including `out/studio/index.html`, and no `site/app/api` directory exists.
- [ ] Search Studio code for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, and external analytics/network calls.
- [ ] Run Rust format, clippy, tests, and release build from `solvec/`.
- [ ] Review desktop, tablet, mobile, keyboard, reduced-motion, editing, analysis, simulation, analytics, restore, import/export, corrupt import, and delete confirmation flows.
- [ ] Commit logical milestones, push `codex/workflow-intelligence-studio-v1`, and open the requested PR without merging.
