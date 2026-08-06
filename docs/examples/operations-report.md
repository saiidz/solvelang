# Operations Report

**Primary status:** Working today for deterministic calculations and threshold-based reporting. Scheduled delivery and external dashboard integrations are not claimed as production features.

## Problem

Operations teams repeatedly turn a few key metrics into the same status update. The calculation rules and escalation thresholds are often implicit or manually recreated.

## Workflow

```solve
let metrics = {
  opened: 18,
  closed: 14,
  backlog: 9,
  urgent: 2
}

let net_change = metrics.opened - metrics.closed

print("Operations report")
print("Opened: " .. metrics.opened)
print("Closed: " .. metrics.closed)
print("Backlog: " .. metrics.backlog)
print("Net queue change: " .. net_change)

if metrics.urgent > 0 {
  print("Attention: urgent items require review")
}

if metrics.backlog > 10 {
  print("Status: backlog above threshold")
} else {
  print("Status: backlog within threshold")
}
```

## Input

```json
{
  "opened": 18,
  "closed": 14,
  "backlog": 9,
  "urgent": 2
}
```

## Output

```text
Operations report
Opened: 18
Closed: 14
Backlog: 9
Net queue change: 4
Attention: urgent items require review
Status: backlog within threshold
```

## Explanation

This example shows the value of using the language without AI. Metrics are structured, calculations are deterministic, and escalation thresholds are inspectable.

## Business value

- standardizes recurring operational summaries
- exposes threshold logic for review
- provides deterministic evidence before adding AI-generated commentary
- can serve as a specification for a scheduled reporting implementation elsewhere

## Expected result

The same input should always produce the same calculations and threshold status. Scheduling, data warehouse queries, Slack delivery, or dashboard writes remain separate implementation concerns.

## Suggested screenshots

1. Metrics object and threshold rules.
2. CLI validation.
3. CLI output.
4. A changed threshold in a Git diff to demonstrate reviewability.

## Suggested demo narration

“This example is useful because it shows SolveLang is not dependent on AI. Deterministic business logic is the foundation. AI can be added only where judgment or summarization is actually useful.”
