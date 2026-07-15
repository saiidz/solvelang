# Workflow Analysis Rules

Workflow Intelligence Studio runs deterministic static checks against the canonical workflow document. It does not call an AI model and does not infer facts not present in the graph.

| Rule | Severity | Check | Primary remediation |
| --- | --- | --- | --- |
| SL001 | Error | No trigger | Add a named starting event. |
| SL002 | Warning | Multiple uncoordinated triggers | Coordinate entry through one decision or shared key. |
| SL003 | Error | No terminal state | Add an explicit outcome. |
| SL004 | Error | Unreachable node | Connect or remove the node. |
| SL005 | Warning | Dead-end node | Add a next, exception, or terminal path. |
| SL006 | Warning | Decision without fallback | Mark one outgoing edge as fallback. |
| SL007 | Warning | Overlapping decision conditions | Make conditions mutually exclusive. |
| SL008 | Error | Empty decision branch | Name the outcome and target. |
| SL009 | Error | Cycle without exit condition | Add a conditional exit edge. |
| SL010 | Error | Human review required but missing | Add a downstream review or approval. |
| SL011 | Error | Approval without approver | Name the approver. |
| SL012 | Warning | Action without owner | Assign accountability. |
| SL013 | Warning | System action without system | Name the executing system. |
| SL014 | Warning | Input without source | Name the input source. |
| SL015 | Warning | Output without destination | Name the destination. |
| SL016 | Recommendation | Missing error path | Add an exception route or error-path reference. |
| SL017 | Recommendation | Missing timeout or SLA | Add modeled SLA minutes. |
| SL018 | Error | High-risk action without review | Require a person or route through review. |
| SL019 | Error | Sensitive data without policy | Reference an applicable policy. |
| SL020 | Warning | Notification without recipient | Name the recipient. |
| SL021 | Warning | Exception never rejoins or terminates | Rejoin or end explicitly. |
| SL022 | Error | Duplicate node ID | Assign unique stable IDs. |
| SL023 | Error | Invalid edge reference | Point to existing nodes. |
| SL024 | Warning | Orphan node | Connect or remove it. |
| SL025 | Recommendation | Unused policy | Reference or remove it. |

## Finding contract

Each finding includes a stable rule ID and finding ID, severity, affected entity, explanation, remediation guidance, evidence, and suppression status. Errors cannot be suppressed in v1. Warnings and recommendations may be suppressed; the UI preserves that decision in the workflow document.

## Automation Readiness Score

The score starts at 100. Unsuppressed findings deduct 12 points per error, 5 per warning, and 2 per recommendation, with finding deductions capped at 50. Coverage can deduct another 50: owner coverage 15, SLA coverage 10, fallback coverage 10, policy coverage 10, and terminal availability 5. The result is clamped to 0–100 and shown with every contributing factor.

This score is an operational review aid, not a guarantee that a workflow is safe or ready for production.
