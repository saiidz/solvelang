# Workflow Intelligence Studio v1

## 1. Product problem

Teams automate operations before they have made the operating model explicit. Triggers, ownership, branch conditions, exceptions, approvals, and human review often live in inboxes or individual judgment. This makes automation brittle and difficult to audit.

SolveLang Workflow Intelligence Studio is a local-first workspace for turning those hidden rules into a canonical workflow model, inspecting the graph, running deterministic checks, simulating scenarios, comparing versions, and exporting evidence before production automation begins. The precise differentiation is: **SolveLang provides deeper pre-automation workflow analysis, policy visibility, scenario simulation, and human-review design for business operations.** It is not a claim of general superiority over agent frameworks.

## 2. Primary user journeys

1. Create a blank project, load a template, import JSON, or complete the structured Describe Workflow wizard.
2. Inspect and edit nodes and edges on the canvas, including owners, systems, policies, risks, SLAs, and human-review requirements.
3. Run deterministic analysis, open findings in context, remediate or suppress eligible findings, and review passed checks and score factors.
4. Create, duplicate, edit, and run scenarios; inspect their execution path, unresolved decisions, policy checks, human pauses, modeled SLA, and terminal result.
5. Compare two scenarios to answer deterministic counterfactual questions such as what changes when urgency becomes urgent.
6. Inspect structural and scenario analytics, quality scores, never-traversed nodes, and local product-use counters.
7. Save, compare, duplicate, or restore local versions with confirmation.
8. Export workflow evidence as JSON, CSV, Markdown, printable HTML, trace JSON, or a preliminary SolveLang-style draft.

## 3. Information architecture

The desktop shell has a left navigation and project rail, a central work surface, a right contextual inspector, and a secondary trace panel. Primary views are Projects, Workflow Canvas, Rule Inspector, Scenario Lab, Run Trace, Analytics, Versions, and Export.

On mobile, the primary views become horizontally scrollable accessible tabs. The canvas switches to a node list with the same select, edit, connect, duplicate, and delete capabilities so the product never depends on a miniature graph. The inspector and trace appear inline below the active view.

## 4. Canonical workflow intermediate representation

`WorkflowDocument` is the canonical browser model and has a schema version, stable identity, name, description, semantic version label, timestamps, nodes, edges, scenarios, policies, analytics metadata, and finding suppressions.

Supported node types are `trigger`, `action`, `decision`, `human_review`, `approval`, `system`, `data_input`, `data_output`, `policy`, `notification`, `timer`, `exception`, and `terminal`.

Every node includes a stable ID, title, description, owner, system, inputs, outputs, policy references, SLA minutes, risk level, human-required flag, evidence entries, x/y position, and string metadata. Approval nodes use `metadata.approver`; notifications use `metadata.recipient`; data inputs use `metadata.source`; data outputs use `metadata.destination`; exception nodes use `metadata.rejoin`; decisions may use `metadata.overlapGroup`.

Every edge includes a stable ID, source, target, condition, numeric priority, label, fallback flag, and string metadata. Conditions are labels resolved by scenario decision outcomes in v1; the Studio does not execute arbitrary expressions.

Zod strictly validates imported and stored documents, including unique IDs and node, policy, and scenario references. Semantic graph checks remain independently available to analyze in-memory fixtures and report integrity evidence; imports are rejected rather than silently repaired.

## 5. Static-analysis rule catalog

The engine runs 25 stable rules:

| ID | Check | Default severity |
| --- | --- | --- |
| SL001 | No trigger | error |
| SL002 | Multiple uncoordinated triggers | warning |
| SL003 | No terminal state | error |
| SL004 | Unreachable node | error |
| SL005 | Dead-end node | warning |
| SL006 | Decision without fallback | warning |
| SL007 | Overlapping decision conditions | warning |
| SL008 | Empty decision branch | error |
| SL009 | Cycle without exit condition | error |
| SL010 | Human review required but missing | error |
| SL011 | Approval step without approver | error |
| SL012 | Action without owner | warning |
| SL013 | System action without system | warning |
| SL014 | Input used without source | warning |
| SL015 | Output produced without destination | warning |
| SL016 | Missing error path | recommendation |
| SL017 | Missing timeout or SLA | recommendation |
| SL018 | High-risk action without human review | error |
| SL019 | Sensitive-data step without policy | error |
| SL020 | Notification without recipient | warning |
| SL021 | Exception path never rejoins or terminates | warning |
| SL022 | Duplicate node identifier | error |
| SL023 | Invalid edge reference | error |
| SL024 | Orphan node | warning |
| SL025 | Unused policy | recommendation |

Every result has a stable finding ID, rule ID, status, severity, affected node or edge, title, explanation, remediation, evidence, and suppressible flag. The UI groups errors, warnings, recommendations, suppressed findings, and passed checks.

Automation Readiness is an integer from 0 to 100. Start at 100 and subtract 12 per unsuppressed error, 5 per warning, and 2 per recommendation, capped at 50 points of deductions. Add coverage deductions of up to 50 points: owner coverage 15, SLA coverage 10, fallback coverage 10, policy coverage 10, and terminal availability 5. Each component and deduction is shown. Suppression removes only suppressible finding deductions, not coverage deductions.

## 6. Scenario-simulation model

A scenario has a stable ID, name, starting trigger, input variables, decision outcomes keyed by decision node ID, expected terminal state, expected human-review node IDs, expected outputs, and optional description.

Simulation is deterministic breadth-limited traversal. At a decision, an edge whose condition or label equals the configured outcome is selected; otherwise a fallback edge is selected. Missing choices become unresolved decisions. Non-decision nodes follow ordered outgoing edges by priority. Traversal stops at a terminal, unresolved decision, dead end, or the v1 safety limit of 200 steps. Revisited edges produce a cycle warning.

The result contains ordered path nodes, branches taken and skipped, unresolved decisions, human-review pauses, policy checks, terminal result, modeled SLA, outputs, warnings, failures, and trace events. Included template scenarios cover happy, missing-data, urgent/high-risk, rejected-approval, and timeout paths.

## 7. Analytics event taxonomy

The Studio records local aggregate counts for `studio_opened`, `project_created`, `template_selected`, `workflow_imported`, `node_created`, `node_updated`, `edge_created`, `analysis_run`, `finding_opened`, `finding_resolved`, `scenario_created`, `scenario_run`, `comparison_opened`, and `export_created`.

The product code calls a small `ProductAnalytics` interface. The v1 adapter writes only event name, count, and last-occurrence timestamp to local storage. A hosted adapter can later implement the same interface after explicit consent without changing feature code.

## 8. Product success metrics

Local product metrics are descriptive, not remotely collected. Useful indicators are projects created, workflows imported, analysis runs per project, percentage of projects with scenarios, scenario run count, findings opened, findings resolved or suppressed, exports created, and restoration actions.

Future opt-in hosted success metrics may include first-analysis completion, time to first valid scenario, finding-remediation rate, export completion, and 7-day project return. No telemetry is transmitted in v1.

## 9. Accessibility requirements

- WCAG-conscious color contrast and no color-only status meaning.
- Semantic landmarks, one page heading, labeled fields, and visible focus rings.
- Full keyboard access to navigation, node selection, graph editing commands, scenario controls, tabs, dialogs, and exports.
- Arrow-key node movement and Enter/Space node selection in the desktop canvas.
- Accessible text labels for icon-like controls and tooltips through native titles or visible labels.
- Live regions for autosave, analysis, simulation, import, and export status.
- Reduced-motion CSS disables transitions and animated canvas behavior.
- Mobile preserves every capability through a list-based workflow editor.
- Destructive restore and delete actions require explicit confirmation.

## 10. Local persistence and privacy model

All workflow content, versions, traces, and aggregate product events remain in browser storage. The repository uses a dependency-free wrapper over `localStorage` with explicit schema version `1`, defensive parsing, a migration hook, and a corrupt-record quarantine key. Incompatible data is never overwritten silently. Users receive a recovery message and can export or delete recoverable data.

Autosave is debounced. Meaningful document changes create deduplicated version snapshots, capped to a documented local history limit. Project deletion requires confirmation and presents an export action first. The Studio contains no fetch, XMLHttpRequest, WebSocket, beacon, external analytics SDK, or AI-provider call.

## 11. Export formats

- Canonical workflow JSON with schema version.
- Analysis findings JSON.
- Structural and scenario analytics JSON and CSV.
- Scenario trace JSON.
- Markdown Workflow X-Ray report.
- Self-contained printable HTML report.
- Preliminary SolveLang-style script.

The script export is labeled `GENERATED DRAFT — REVIEW BEFORE RUNNING`. It emits readable comments for Studio-only node types and preserves policy and human-review intent. It never claims full Studio-to-runtime compatibility. Copy uses the browser clipboard when available; downloads use local Blob URLs created from user-selected content.

## 12. Testing strategy

Pure TypeScript modules cover schema validation, graph integrity, every static rule, score formulas, traversal, unresolved decisions, human pauses, policy checks, trace generation, comparison, structural and scenario analytics, storage migration, corrupt-data recovery, import/export round trips, draft generation, and local event counters. Tests run through TypeScript compilation and Node's built-in test runner, avoiding a new framework.

The Next build provides strict TypeScript and static-export validation. Manual browser review covers desktop, tablet, mobile, keyboard-only use, reduced motion, workflow creation, graph edits, analysis, simulation, analytics, restore, import/export, corrupt import, and delete confirmation.

## 13. Known boundaries

- The Studio does not extract workflows from unstructured prose with AI.
- Scenario conditions are explicit labels, not a general expression language.
- The canvas is dependency-light and designed for operational maps, not thousands of nodes.
- Local storage is device- and browser-specific and has browser-defined capacity limits.
- Generated scripts are drafts; the Rust CLI remains canonical for full `.solve` validation and execution.
- No multi-user collaboration, hosted persistence, integrations, real-time execution, or external analytics exist in v1.
- Studio analysis is deterministic static analysis, not AI analysis or a guarantee that automation is safe.

## 14. Migration path to a hosted backend later

The Workflow IR and export schema remain transport-independent. Storage, product analytics, and runtime validation are accessed through narrow interfaces. A hosted version can add authenticated project storage, collaboration, consented telemetry, server-side version retention, and Rust CLI validation as adapters while retaining the local engine and offline mode.

Migration must be explicit and user-controlled: users choose whether to upload a local project, receive a preview of transferred fields, and can continue using local-only mode. Hosted execution, billing, integrations, and secret management are separate future milestones and are not implied by v1.
