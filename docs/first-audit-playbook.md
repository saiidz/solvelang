# First Workflow Audit Playbook

Use this when someone replies to outreach or emails `hello@solve-lang.com` with a messy workflow.

## Goal

The goal is to turn one messy workflow into a clear workflow audit deliverable and, if appropriate, a paid fixed-scope setup plan.

Do not try to sell a full SaaS platform first. Start by understanding the workflow, mapping the current process, identifying manual decisions, and deciding whether a focused audit is useful.

## When Someone Replies Interested

```text
Great - send the rough workflow to hello@solve-lang.com or use this checklist:
https://www.solve-lang.com/audit/

The most useful details are:
- What starts the workflow?
- What tools are involved?
- What decisions happen manually today?
- What should happen automatically?
- What output would make this successful?

Rough notes are fine.
```

## Intake Checklist

Collect enough detail to map the workflow without asking for production credentials.

- Trigger: What starts the workflow?
- Inputs: What information comes in?
- Tools: Which tools are involved?
- Manual decisions: What judgment calls happen today?
- People involved: Who handles, reviews, or receives the output?
- Current pain: What is slow, messy, repetitive, or risky?
- Desired output: What should be created, sent, routed, updated, or summarized?
- Success condition: What would make this worth fixing?
- Frequency: How often does this workflow happen?
- Risk if it breaks: What would be bad if the workflow was wrong?

## How To Map The Workflow

Use this structure for the first pass:

1. Trigger: the event that starts the workflow.
2. Classify/categorize: how the request should be understood.
3. Decision rules: the manual rules, judgment calls, thresholds, or routing logic.
4. Action/output: the task, message, reply, update, or summary that should happen.
5. Human review point: where a person should approve, edit, or override the workflow.
6. Failure/edge cases: missing information, unclear requests, duplicate inputs, sensitive cases, or tool failures.
7. Next step: the smallest useful follow-up after the audit.

## Deliverable Template

```markdown
# Workflow Audit: [Workflow Name]

## Current process

## Pain points

## Trigger

## Inputs

## Manual decisions

## Desired output

## Suggested SolveLang-style workflow

## Automation path

## Tools/integrations needed

## Risks / human review points

## Recommended next step
```

## SolveLang-Style Draft Template

This can be pseudo-code. It does not need to be production-ready, but it should be readable enough for the customer to inspect.

```solve
agent SupportRouter {
  instruction "Classify incoming requests and route the next action."
  tool createTask
}

let priority = "high"
let queue = "support"

if priority == "high" {
  print("Escalate and create follow-up task")
}
```

## How To Price The First Audit

Keep pricing simple and fixed-scope.

- Free quick look only if needed to build trust.
- Paid fixed-scope workflow audit: `$300-$500`.
- Custom implementation quote only after the workflow is mapped.

Use the lower end when the workflow has one clear trigger, one main decision path, and one output. Use the higher end when there are multiple tools, branches, owners, or edge cases.

Do not add checkout yet. Send a written quote and confirm scope before doing paid work.

## What Not To Promise

- Do not promise full production automation before mapping the workflow.
- Do not promise autonomous legal, medical, or financial decisions.
- Do not ask for production credentials during the audit.
- Do not overpromise integrations.
- Do not sell SaaS subscriptions before there is a real workflow need.
- Do not imply the hosted browser preview is the full production runtime.

## First Case Study Capture

Only capture a case study after a real audit or setup. Do not invent customers, proof, or outcomes.

Record:

- Before workflow
- Manual pain
- Proposed workflow map
- Outcome
- Quote/testimonial if allowed
- What can be shared publicly

Use a private or anonymized version if the customer does not want their name, tools, or workflow details public.
