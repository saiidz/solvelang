# Customer Pain Points

## Workflow rules live in people's heads

Symptoms:

- different employees handle the same request differently,
- nobody can point to the current process definition,
- onboarding new staff requires shadowing instead of documentation,
- automation changes are difficult to review.

Service response: map the current process, separate deterministic rules from judgment, and create a readable workflow specification.

## Visual automations are hard to review after they grow

Symptoms:

- large canvases with hidden branches,
- duplicated logic,
- unclear ownership of changes,
- fragile handoffs between tools.

Service response: document the current workflow, identify duplication and risk, then produce a source-controlled specification before refactoring.

## AI has been added without clear boundaries

Symptoms:

- prompts directly trigger consequential actions,
- no human review for uncertain output,
- nobody can explain what the model is allowed to decide,
- failure behavior is undefined.

Service response: identify AI-assisted decisions, define confidence/review boundaries, and keep deterministic actions explicit.

## Manual handoffs create delays

Symptoms:

- shared inboxes,
- copy/paste between systems,
- repeated data entry,
- Slack/Teams messages used as unofficial queues,
- follow-ups missed because ownership is unclear.

Service response: model the handoff, define routing criteria, and implement only the approved transitions.

## Existing automations are undocumented

Symptoms:

- the original builder has left,
- nobody knows which automation writes to which system,
- changes are risky,
- credentials and ownership are unclear.

Service response: perform an automation rescue audit, inventory dependencies, document failure paths, and prioritize stabilization.

## Leaders cannot estimate automation ROI

Symptoms:

- time savings are guessed,
- error costs are unknown,
- model/API costs are ignored,
- teams cannot compare manual work with implementation cost.

Service response: build a baseline using customer-supplied volumes, labor time, error rates, and platform costs before promising savings.

## What SolveLang should not promise

- full automation of an unobserved process,
- elimination of human review where consequences are material,
- guaranteed ROI,
- production orchestration capabilities that are still planned,
- compliance outcomes without independent validation.