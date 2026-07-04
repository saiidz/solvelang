# First Workflow Audit Playbook

Use this when a founder, operator, agency, consultant, or small team sends a messy workflow to `hello@solve-lang.com`.

The goal is not to sell a full SaaS platform. The goal is to understand one real manual workflow, map it clearly, and decide whether a fixed-scope workflow audit or setup plan is useful.

## The offer

Simple version:

> Send one messy workflow. We map the current process, identify manual decisions, draft a readable SolveLang-style workflow, outline the automation path, and recommend the next setup step.

Best-fit workflows:

- Support triage
- Lead qualification
- Client intake routing
- Founder inbox cleanup
- Customer follow-up routing
- Internal ops status reports
- Spreadsheet-to-task handoffs
- Repetitive handoffs between email, Slack, forms, spreadsheets, and task tools

Not a fit yet:

- Workflows that require production access before mapping
- Regulated legal, medical, or financial decisions
- Fully autonomous decisions without human review
- Large enterprise approval chains with many stakeholders
- Requests where the buyer wants a finished hosted platform before defining the workflow

## First reply template

Use this after someone emails a workflow or replies to outreach.

```text
Hi [Name],

Thanks for sending this. The next useful step is to map one workflow clearly before talking about implementation.

Can you send a rough version of:

1. What starts the workflow?
2. What tools are involved?
3. What decisions happen manually today?
4. What should happen automatically?
5. What output would make this successful?

Messy notes are fine. I am looking for the current process, not a polished spec.

Once I have that, I can tell you whether this is a good fit for a fixed-scope workflow audit.
```

## Qualification checklist

Before quoting, confirm these basics.

- Trigger: What event starts the workflow?
- Inputs: What information arrives at the start?
- Tools: Which tools are involved today?
- Owner: Who handles the workflow manually?
- Decisions: What judgment calls happen now?
- Output: What should be created, sent, updated, or summarized?
- Frequency: How often does this happen?
- Pain: What breaks when the process is manual?
- Risk: What would be bad if the automation was wrong?
- Review: Where should a human stay in the loop?

Good signs:

- The workflow happens repeatedly.
- The current rules are explainable in plain English.
- The prospect can name the trigger and desired output.
- The pain is concrete: missed leads, slow support, copied data, delayed follow-up, messy reporting.
- The first step can be mapped without production access.

Bad signs:

- The workflow depends on unclear judgment no one can describe.
- The buyer wants fully autonomous action in a sensitive area.
- The buyer cannot name the desired output.
- The first step requires direct access to private systems.
- The project is really a broad process redesign, not one workflow.

## Audit scope

Keep the first paid audit narrow.

Included:

- One workflow from trigger to output
- One plain-English workflow map
- One SolveLang-style draft
- Manual decision inventory
- Automation path
- Tools and integrations needed
- Human review points
- Risks and edge cases
- Recommended next step

Not included:

- Production deployment
- Live integrations
- Backend buildout
- Payment setup
- Auth setup
- Long-term maintenance
- Guaranteed automation performance
- Compliance, legal, medical, or financial review

## Suggested pricing

Use fixed-scope pricing for the first audit.

- Simple workflow audit: `$300`
- More complex workflow audit: `$500`

Use `$300` when:

- One trigger
- One main owner
- One or two tools
- Clear output
- Few edge cases

Use `$500` when:

- Multiple tools
- Multiple decision branches
- Several outputs
- More edge cases
- The prospect wants a deeper setup recommendation

Do not add checkout yet. Send a simple written quote and only discuss custom implementation after the workflow is mapped.

## Quote template

```text
Hi [Name],

This looks like a good fit for a fixed-scope workflow audit.

For [workflow name], I would map:

- current trigger and inputs
- manual decisions
- owner/routing rules
- desired output
- risks and review points
- a readable SolveLang-style workflow draft
- a recommended automation path

Fixed scope: $[300/500]
Timeline: [timeframe]

This would not include production deployment or live integrations yet. The goal is to make the workflow clear enough to decide the right setup step.

If that works, I can send the next step.
```

## Audit deliverable template

Use this structure for the document you send back.

````markdown
# Workflow Audit: [Workflow Name]

## Summary
[One paragraph explaining the workflow and recommended next step.]

## Current Process
- Trigger:
- Inputs:
- Tools involved:
- Current owner:
- Manual steps:
- Manual decisions:
- Current output:

## Pain Points
- [Pain point 1]
- [Pain point 2]
- [Pain point 3]

## Desired Workflow
- Trigger:
- Required inputs:
- Routing rules:
- Human review points:
- Desired output:

## SolveLang-Style Draft

```solve
# Draft only. Validate against current SolveLang syntax before running.
let workflow = "[workflow name]"
let trigger = "[trigger]"
let priority = "[priority]"

print("Review workflow")
print(workflow)

if priority == "high" {
  print("Route for human review")
}
```

## Automation Path
1. Map the workflow rules.
2. Confirm the owner and output.
3. Validate the SolveLang-style draft.
4. Identify required tools or integrations.
5. Decide what should stay human-reviewed.
6. Scope custom setup if useful.

## Tools and Integrations Needed
- [Tool 1]
- [Tool 2]
- [Tool 3]

## Risks and Edge Cases
- [Risk 1]
- [Risk 2]
- [Risk 3]

## Recommended Next Step
[One concrete recommendation.]

## Optional Custom Setup Quote
[Only include if there is a clear next implementation step.]
````

## Follow-up after sending the audit

```text
Hi [Name],

I sent the workflow audit for [workflow name].

The main recommendation is:
[one-sentence recommendation]

If that direction looks right, the next step would be to scope the setup work around [specific next step].

Worth mapping that next?
```

## Case study capture

Do not invent proof. Only capture a case study after a real audit or setup.

Use this blank template:

```markdown
# Case Study Notes: [Customer / Workflow]

## Customer / Problem

## Before Workflow

## Manual Pain

## Trigger

## Decisions

## Output

## Proposed Map

## Result

## Testimonial Permission
- Can quote publicly:
- Can name customer:
- Can mention tools:
- Needs private/anonymized version:

## Public / Private Sharing Notes
```

## Final fit check

Before accepting the audit, ask:

- Does this help the buyer map one real workflow?
- Can the workflow be explained without private production access?
- Is there a concrete trigger, decision, and output?
- Is human review clear where needed?
- Can the deliverable be useful even before integrations exist?
- Is this a fixed-scope audit instead of an open-ended build?

If the answer is no, do not force the sale. Ask for a simpler workflow or decline politely.
