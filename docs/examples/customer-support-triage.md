# Customer Support Triage

**Primary status:** Working today for the deterministic routing core. External inbox, task, Slack, and reply integrations are not claimed as production-connected.

## Problem

A shared support inbox creates repeated manual reading, unclear ownership, inconsistent urgency handling, and missed follow-up.

## Workflow

Represent the ticket as structured data, inspect topic and priority, choose an owner, and make urgent escalation explicit.

```solve
let ticket = {
  customer: "Acme Labs",
  topic: "billing",
  priority: "urgent",
  plan: "pro"
}

print("Support triage")
print("Customer: " .. ticket.customer)
print("Topic: " .. ticket.topic)

if ticket.priority == "urgent" {
  print("Action: escalate to founder today")
} else {
  print("Action: add to normal support queue")
}

if ticket.topic == "billing" {
  print("Owner: finance operations")
} else {
  print("Owner: support operations")
}
```

Canonical repository example: `examples/support_triage.solve`.

## Input

```json
{
  "customer": "Acme Labs",
  "topic": "billing",
  "priority": "urgent",
  "plan": "pro"
}
```

## Output

```text
Support triage
Customer: Acme Labs
Topic: billing
Action: escalate to founder today
Owner: finance operations
```

## Explanation

The value of the example is not autonomous ticket handling. It is that ownership and escalation rules are visible, reviewable, and testable. The deterministic business rules stay separate from any future classifier, inbox connector, or reply generator.

## Business value

- reduces ambiguity about ownership
- makes escalation rules reviewable
- gives a consultant a concrete artifact for stakeholder approval
- creates a clean boundary for later AI classification or messaging assistance

## Expected result

Running the canonical example through the Rust CLI should print the deterministic routing decision above. No email, Slack message, or external task should be implied by this local example.

## Suggested screenshots

1. `examples/support_triage.solve` in GitHub or an editor.
2. Terminal showing `cargo run -- validate ../examples/support_triage.solve`.
3. Terminal showing the run output.
4. Support-triage presentation page, clearly labeled as a presentation rather than execution proof.

## Suggested demo narration

“Here is the core design idea. The support policy is readable source, not hidden in a visual canvas or a prompt. The Rust runtime can validate and execute these deterministic rules today. If we later connect an inbox or an AI classifier, those capabilities sit around this policy instead of replacing it.”
