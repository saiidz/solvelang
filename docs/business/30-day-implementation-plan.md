# 30-Day Implementation Plan

This is a reusable delivery framework, not a promise that every engagement completes in 30 days.

## Days 1-5 — Discovery and baseline

- name the process owner and decision owner
- document the trigger, systems, data, rules, AI-assisted steps, approvals, exceptions, and failure paths
- collect client-supplied volume/effort baseline
- define security and data constraints
- agree on one narrow target workflow

**Gate:** no implementation begins until scope and acceptance criteria are approved.

## Days 6-10 — Readable specification

- create current-state map
- create target-state readable workflow
- separate deterministic rules from AI judgment
- document permissions and human-review points
- define test fixtures and expected outputs
- choose execution platform based on requirements, not SolveLang loyalty

**Deliverable:** reviewed workflow specification and implementation plan.

## Days 11-20 — Prototype and integration

- build the smallest approved implementation
- use existing client tools where appropriate
- keep credentials out of source control
- add deterministic tests around business rules
- add representative AI evaluation cases where AI is used
- implement failure handling and observability appropriate to the target platform

**Gate:** no unattended consequential action without explicit approval.

## Days 21-25 — Acceptance testing

- run normal cases
- run malformed and missing-input cases
- run provider/integration failure cases
- confirm human-review paths
- compare results against acceptance criteria
- record unresolved risks

## Days 26-30 — Handoff and next decision

- document architecture and ownership
- document operating procedure and rollback path
- train process owner
- record third-party/model cost assumptions
- define maintenance scope if needed
- decide: stop, maintain, expand, or productize

## End-of-engagement artifacts

- process inventory
- readable workflow specification
- implementation source/configuration as scoped
- test evidence
- limitations and risk register
- operating/handoff notes
- next-step recommendations

## Success definition

Success is not “the automation ran once.” Success means the agreed workflow is understandable, testable, owned, and accepted within the explicitly scoped environment.
