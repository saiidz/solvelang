# Lead Qualification

**Primary status:** Working today for deterministic qualification logic. CRM writes, enrichment, email sending, and autonomous sales actions are not claimed as production integrations.

## Problem

Inbound leads are often reviewed inconsistently. Different people may apply different rules for fit, urgency, and routing.

## Workflow

Use explicit fields and deterministic conditions to decide whether a lead should receive founder follow-up or remain in nurture.

```solve
let lead = {
  company: "Northstar Ops",
  employees: 42,
  use_case: "workflow audit",
  requested_demo: true
}

print("Lead qualification")
print("Company: " .. lead.company)

if lead.employees >= 20 and lead.requested_demo {
  print("Status: qualified")
  print("Next step: founder follow-up")
} else {
  print("Status: nurture")
  print("Next step: send educational material")
}
```

## Input

```json
{
  "company": "Northstar Ops",
  "employees": 42,
  "use_case": "workflow audit",
  "requested_demo": true
}
```

## Output

```text
Lead qualification
Company: Northstar Ops
Status: qualified
Next step: founder follow-up
```

## Explanation

This example demonstrates that the qualification rule itself can be version controlled and reviewed. A future enrichment or scoring model can provide inputs, but the business decision does not have to disappear inside a model prompt.

## Business value

- creates consistent qualification criteria
- makes changes to sales policy reviewable in Git
- separates lead data collection from the routing decision
- provides a clear implementation specification for Zapier, n8n, Make, Pipedream, or custom code

## Expected result

The deterministic example should produce the same qualification decision for the same input. It should not be presented as writing to a live CRM or sending an email.

## Suggested screenshots

1. Lead object and qualification rule in source.
2. CLI validation success.
3. CLI output showing `qualified` and `founder follow-up`.
4. A simple architecture slide showing “lead source → SolveLang policy → external CRM implementation” with the external implementation labeled planned or client-specific.

## Suggested demo narration

“This is intentionally simpler than a CRM automation platform. SolveLang’s job here is to make the qualification policy explicit. The same policy can then be implemented in the client’s existing stack instead of forcing them onto a new automation runtime.”
