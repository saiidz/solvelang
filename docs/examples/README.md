# SolveLang Example Catalog

These examples translate the current SolveLang prototype into recognizable business-process scenarios. They are designed for portfolio reviews, demos, consulting discovery, and future implementation planning.

## Truth labels

- **Working today** — the deterministic core can be represented with syntax supported by the canonical Rust CLI runtime.
- **Experimental** — the repository contains related functionality, but it is unstable, provider-dependent, side-effecting, or not suitable for production promises.
- **Planned** — the business workflow is useful as a specification or consulting artifact, but the required integration or runtime capability is not implemented as a production feature.

The Rust CLI in `solvec/` remains the canonical executable runtime. Workflow Intelligence Studio can model broader concepts than the executable language, so Studio-generated `.solve` output must be treated as a preliminary draft and validated before execution.

## Examples

| Example | Primary status | What it demonstrates |
| --- | --- | --- |
| [Customer support triage](customer-support-triage.md) | Working today | deterministic classification inputs, routing rules, ownership, human escalation |
| [Lead qualification](lead-qualification.md) | Working today | rule-based qualification and explicit sales routing |
| [CRM automation](crm-automation.md) | Planned integration | readable decision logic separated from external CRM mutation |
| [Invoice processing](invoice-processing.md) | Planned integration | document-derived fields, deterministic checks, approval boundaries |
| [Operations report](operations-report.md) | Working today | structured input, calculations, thresholds, readable output |
| [Email summarization](email-summarization.md) | Experimental AI | explicit boundary between model-generated summary and human-reviewed action |
| [Document classification](document-classification.md) | Experimental AI | classification intent, validation, and deterministic downstream routing |
| [Approval workflow](approval-workflow.md) | Working logic / planned orchestration | explicit policy checks and human approval without claiming managed orchestration |

## Recommended demo order

For a recruiter or technical interviewer:

1. Customer support triage — easiest end-to-end deterministic story.
2. Operations report — demonstrates data handling and runtime behavior without AI.
3. Email summarization — demonstrates how SolveLang separates model behavior from deterministic business rules.
4. Approval workflow — demonstrates product and governance thinking.

For a prospective consulting client:

1. Start with the workflow closest to their current pain.
2. Explain the process in business language before showing syntax.
3. Mark each external system action as implemented, experimental, or planned.
4. Use the SolveLang definition as a review and handoff artifact even if the final automation runs in another platform.

## Validation rule

Do not present an example as executable unless its script has been validated with the canonical CLI. Do not present external systems, AI outputs, or integrations as live unless they are actually connected and verified in the environment being demonstrated.
