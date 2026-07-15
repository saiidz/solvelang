# Workflow Analytics

Studio analytics are calculated locally from the canonical graph and scenario results. Values are recomputable and no workflow data or metric is sent externally.

## Structural metrics

Studio reports node, edge, decision, exception-path, human-review, approval, system, handoff, and branch counts; average and maximum path depth; and policy, owner, SLA, fallback, and exception coverage. A handoff is a valid edge whose source and target have different non-empty owners.

Coverage percentages use `matching entities / eligible entities × 100`. A category with no eligible entity is treated as fully covered rather than creating a synthetic failure.

## Scenario metrics

Scenario pass rate, expected-terminal match, unresolved-decision rate, human-review coverage, average and maximum modeled cycle time, path coverage, node coverage, edge coverage, failure distribution, frequently traversed nodes, and never-traversed nodes are derived from local deterministic runs.

Modeled cycle time is the sum of node SLA minutes along the simulated path. It is not measured production latency.

## Quality scores

- Automation readiness uses the published finding and coverage deductions.
- Explainability weights owner coverage, fallback coverage, and node descriptions.
- Resilience weights exception coverage, scenario pass rate, and fallback coverage.
- Governance weights policy coverage, human-review coverage, and owner coverage.
- Observability weights SLA coverage, node coverage, and named outputs.

Each quality score is a rounded whole-number weighted average. The UI shows the formula and every factor so the score avoids misleading precision.

## Product-use events

The local adapter counts `studio_opened`, `project_created`, `template_selected`, `workflow_imported`, `node_created`, `node_updated`, `edge_created`, `analysis_run`, `finding_opened`, `finding_resolved`, `scenario_created`, `scenario_run`, `comparison_opened`, and `export_created`. Only event count and last occurrence time are stored. No event payload or workflow content is collected.
