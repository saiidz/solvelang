# CRM Automation

**Primary status:** Planned integration. The policy layer can be expressed today, but SolveLang does not claim a production CRM connector or managed workflow runtime.

## Problem

CRM automations often spread across form rules, enrichment tools, visual automation canvases, and ad hoc scripts. The business reason for each mutation becomes hard to review.

## Workflow

Keep the decision policy readable, then treat external CRM mutation as an implementation concern.

```solve
let lead = {
  name: "Taylor Reed",
  company: "Northstar Ops",
  stage: "new",
  requested_demo: true
}

let next_stage = "nurture"

if lead.requested_demo {
  next_stage = "sales_review"
}

print("CRM decision")
print("Company: " .. lead.company)
print("Current stage: " .. lead.stage)
print("Recommended stage: " .. next_stage)
```

## Input

A normalized lead record containing the fields needed for the decision. In a real engagement, the source could be a form, CRM webhook, CSV export, or another automation platform.

## Output

```text
CRM decision
Company: Northstar Ops
Current stage: new
Recommended stage: sales_review
```

## Explanation

The example stops at the decision boundary. It does not pretend to update Salesforce, HubSpot, or another CRM. A client implementation could translate the recommendation into an external API call after authentication, authorization, idempotency, audit logging, and rollback behavior are designed.

## Business value

- separates CRM policy from vendor-specific API plumbing
- makes lead-stage changes auditable
- provides an implementation contract for a consultant or engineering team
- reduces the chance that business rules exist only inside a visual automation

## Expected result

The deterministic policy returns a recommended stage. The external write remains **Planned** until a specific CRM adapter or client implementation is built and verified.

## Suggested screenshots

1. Source showing the policy and recommended stage.
2. Terminal output.
3. Architecture diagram with the CRM write shown as a separate adapter boundary.
4. A diff changing the stage rule to demonstrate version control.

## Suggested demo narration

“Instead of claiming SolveLang replaces a CRM automation platform, this example shows where it can be strongest: the policy is readable and reviewable, while the vendor-specific mutation stays behind a clearly defined adapter boundary.”
