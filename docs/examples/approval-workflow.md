# Approval Workflow

**Primary status:** Working today for deterministic approval policy; planned for managed orchestration, identity-backed approvals, notifications, and durable waiting.

## Problem

Approval logic is often buried in email threads or automation branches. Teams need to know exactly when approval is required, who is responsible, and what can proceed automatically.

## Workflow

```solve
let request = {
  type: "vendor_purchase",
  amount: 3200,
  budgeted: true,
  requester_role: "operations"
}

print("Approval review")

if not request.budgeted {
  print("Decision: reject pending budget review")
} else {
  if request.amount > 2500 {
    print("Decision: manager approval required")
  } else {
    print("Decision: within delegated approval limit")
  }
}
```

## Input

```json
{
  "type": "vendor_purchase",
  "amount": 3200,
  "budgeted": true,
  "requester_role": "operations"
}
```

## Output

```text
Approval review
Decision: manager approval required
```

## Explanation

The approval policy itself is deterministic and readable. SolveLang does not currently claim durable waiting for a manager response, identity verification, approval inboxes, or enterprise BPM orchestration. Those are separate runtime concerns.

## Business value

- makes delegated authority visible
- creates reviewable policy instead of email-only decisions
- provides a clean boundary for future human approval systems
- supports consulting discovery around exceptions, ownership, and escalation

## Expected result

The policy should identify whether the request is rejected, within a delegated limit, or requires manager approval. It should not be presented as actually collecting or persisting a manager decision.

## Suggested screenshots

1. Approval threshold source.
2. CLI output for a request above the threshold.
3. A second run below the threshold.
4. Studio visualization of an approval/human-review step, labeled as modeling rather than durable production orchestration.

## Suggested demo narration

“This demonstrates an important boundary. SolveLang can express the approval policy today, but I would not claim it is Temporal or Camunda. Durable waiting, identity, notifications, and escalation timers are runtime capabilities that would need to be implemented or delegated to an existing orchestration platform.”
