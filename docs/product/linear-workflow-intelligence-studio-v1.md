# Linear Plan: SolveLang Workflow Intelligence Studio v1

Direct Linear project creation was not used for this repository task. This document preserves the exact project structure for later import.

## Project

**SolveLang Workflow Intelligence Studio v1**

Build a local-first static product for canonical workflow modeling, deterministic analysis, scenario simulation, trace evidence, analytics, local versions, and exports. Workflow data remains in the browser and the Rust CLI remains canonical for executable `.solve` behavior.

## Milestones

1. Product model and foundations
2. Canvas and editing
3. Analysis engine
4. Scenario simulation
5. Trace and analytics
6. Versioning and exports
7. Product polish and launch

## Issues

### SL-1 Define Workflow IR and schema

Milestone: Product model and foundations. Define all 13 node types, edge fields, policies, scenarios, analytics metadata, stable IDs, schema version, and Zod validation.

Dependencies: none.

Acceptance: valid templates parse; unsupported node types fail; JSON round trip preserves canonical fields.

### SL-2 Build local project storage

Milestone: Product model and foundations. Add schema-versioned local project, trace, and version repositories with migration hook and corrupt-data quarantine.

Dependencies: SL-1.

Acceptance: project CRUD works; incompatible data is not overwritten; delete removes project artifacts after export.

### SL-3 Create Studio application shell

Milestone: Product model and foundations. Build Projects, Canvas, Rules, Scenarios, Trace, Analytics, Versions, and Export navigation with local-only status.

Dependencies: SL-1, SL-2.

Acceptance: all views are keyboard reachable and static-exported; desktop and mobile navigation preserve every view.

### SL-4 Build workflow canvas

Milestone: Canvas and editing. Render directed edges and typed nodes with pan, zoom, fit, selection, add, duplicate, delete, connect, and keyboard movement.

Dependencies: SL-3.

Acceptance: graph changes update canonical state; mobile uses an accessible node list rather than a miniature graph.

### SL-5 Build node and edge inspector

Milestone: Canvas and editing. Edit operational node fields, human-review state, metadata, and outgoing branch conditions/fallbacks.

Dependencies: SL-4.

Acceptance: edits autosave and change analysis results; invalid in-memory graph references remain visible to analysis while imports fail closed.

### SL-6 Implement graph integrity validation

Milestone: Analysis engine. Add indexes, reachability, cycle detection, edge-reference checks, and graph depth helpers.

Dependencies: SL-1.

Acceptance: invalid edges, duplicate IDs, unreachable nodes, orphans, dead ends, and cycles are deterministic and tested.

### SL-7 Implement static-analysis rules

Milestone: Analysis engine. Implement SL001–SL025 with evidence, remediation, severity, passed checks, and suppression eligibility.

Dependencies: SL-6.

Acceptance: one focused fixture proves every rule; errors cannot be suppressed.

### SL-8 Implement readiness and quality scores

Milestone: Analysis engine. Implement readiness, explainability, resilience, governance, and observability formulas with visible factors.

Dependencies: SL-7.

Acceptance: scores are integer, deterministic, locally recomputable, documented, and avoid unsupported precision.

### SL-9 Build Scenario Lab

Milestone: Scenario simulation. Create, duplicate, edit, select, and run scenarios with explicit trigger, inputs, outcomes, expectations, and output checks.

Dependencies: SL-3, SL-4.

Acceptance: included templates expose happy, missing-data, urgent, rejected-approval, and timeout scenarios.

### SL-10 Build deterministic simulator

Milestone: Scenario simulation. Traverse priority-ordered edges, resolve explicit outcomes/fallbacks, pause on unresolved decisions, and guard cycles.

Dependencies: SL-6, SL-9.

Acceptance: path, branches, reviews, policies, terminal, outputs, SLA, warnings, and failures are tested without internet.

### SL-11 Build trace and replay

Milestone: Trace and analytics. Generate ordered trace events, timeline and node-focused details, replay controls, canvas jump, and trace JSON.

Dependencies: SL-10.

Acceptance: sequence is deterministic; every event includes the documented trace contract; traces persist locally.

### SL-12 Build counterfactual comparison

Milestone: Scenario simulation. Compare two deterministic runs for path, owner, decision, human review, SLA, risk, outputs, and terminal changes.

Dependencies: SL-10.

Acceptance: urgent-versus-normal comparison reports real differences and never invokes AI.

### SL-13 Build workflow analytics dashboard

Milestone: Trace and analytics. Compute structural, scenario, coverage, failure, frequency, and five quality score families.

Dependencies: SL-7, SL-10.

Acceptance: each required metric has deterministic unit coverage and visible formula context.

### SL-14 Build version history and comparison

Milestone: Versioning and exports. Create deduplicated snapshots, restore confirmation, duplication, and graph/policy/scenario/score comparison.

Dependencies: SL-2, SL-7.

Acceptance: restore preserves the pre-restore version; compare lists added, removed, modified, and score changes.

### SL-15 Add import/export and reports

Milestone: Versioning and exports. Support workflow/findings/analytics/traces JSON, analytics CSV, Markdown, and printable HTML.

Dependencies: SL-1, SL-7, SL-11, SL-13.

Acceptance: import/export round trip passes; corrupt import leaves current state unchanged; downloads are local Blob files.

### SL-16 Generate preliminary SolveLang drafts

Milestone: Versioning and exports. Generate readable drafts with unsupported Studio concepts as comments.

Dependencies: SL-1, SL-15.

Acceptance: every draft is labeled generated, preserves policy and review intent, and directs users to Rust CLI validation.

### SL-17 Add privacy-safe local product analytics

Milestone: Product model and foundations. Track the 14 documented event names through a local aggregate-only interface.

Dependencies: SL-2.

Acceptance: only count and last occurrence are stored; no payload or external call exists.

### SL-18 Add templates and fixtures

Milestone: Product model and foundations. Add five product templates and the required valid/invalid analysis fixtures.

Dependencies: SL-1.

Acceptance: all templates parse and contain editable scenarios; every named fixture is deterministic.

### SL-19 Add homepage Studio integration

Milestone: Product polish and launch. Make Open Studio the homepage primary action while preserving truthful positioning and existing routes.

Dependencies: SL-3.

Acceptance: homepage and Resources link `/studio/`; local-only and runtime boundaries are stated.

### SL-20 Add tests, documentation, accessibility, and responsive polish

Milestone: Product polish and launch. Complete automated core coverage, docs, static export, keyboard and reduced-motion support, and manual responsive review.

Dependencies: SL-1 through SL-19.

Acceptance: required site and Rust validation pass; all required static files exist; no active API route or Studio network client exists; desktop, tablet, mobile, keyboard, reduced-motion, CRUD, analysis, simulation, restore, import/export, corrupt import, and delete confirmation are reviewed.
