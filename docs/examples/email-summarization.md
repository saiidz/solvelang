# Email Summarization

**Primary status:** Experimental AI. SolveLang has experimental agent syntax and optional OpenAI-backed responses, but email ingestion, production model guarantees, autonomous sending, and managed execution are not production claims.

## Problem

Teams spend time reading long inbound messages before deciding what matters, who owns the response, and whether a human needs to intervene.

## Workflow

The intended pattern is: provide the message to an AI-assisted summarization step, then keep routing and escalation deterministic.

Illustrative shape:

```solve
let email = {
  from: "ops@acme-labs.com",
  subject: "Renewal blocked by duplicate charge",
  body: "We were charged twice and need this fixed before renewal."
}

print("Email received")
print("Subject: " .. email.subject)

// Experimental boundary:
// an agent may produce a summary or proposed classification.
// Deterministic rules should decide what happens next.
```

## Input

```json
{
  "from": "ops@acme-labs.com",
  "subject": "Renewal blocked by duplicate charge",
  "body": "We were charged twice and need this fixed before renewal."
}
```

## Output

A model-generated summary should be treated as a proposal, for example:

```text
Customer reports a duplicate billing charge that may block renewal and requests same-day review.
```

That text is an illustrative expected shape, not a deterministic benchmark or guaranteed model response.

## Explanation

The core architectural point is that model output should not silently become a business action. Summarization belongs at an explicit AI boundary; routing, permissions, approvals, and side effects should remain separately reviewable.

## Business value

- reduces repeated reading for long messages
- makes the AI boundary visible
- supports human review before consequential actions
- provides a specification that can later be implemented with a chosen model provider

## Expected result

A demo may show experimental summarization when provider configuration is intentionally enabled. The presenter must state that model output can vary and that the repository does not claim a production email-ingestion or autonomous-response system.

## Suggested screenshots

1. Source showing the structured email input and AI boundary comment.
2. Experimental agent/provider configuration documentation.
3. A diagram separating “AI proposes summary” from “deterministic rules decide next action.”
4. Human-review state in Studio if used, labeled as deterministic modeling rather than AI execution.

## Suggested demo narration

“This is where SolveLang’s AI positioning matters. The model is not the workflow. The model can propose a summary, while the process definition still makes ownership, approval, and side effects explicit.”
