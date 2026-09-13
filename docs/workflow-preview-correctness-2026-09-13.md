# Workflow and support preview correctness

Scope: repair the local previews introduced in #892/#893. This does not activate a connected support agent, send email, create a remote task, authorize billing or change any cloud resource.

## Changes

The audit and support routes now share a typed deterministic planning core. Whitespace and insufficient descriptions produce a needs-details state with no actions, reply or script; oversize input is rejected rather than silently truncated. The core never returns execution authorization. Sensitive financial, destructive, account/security and regulated terms are evaluated separately from category selection; absence of a detected term is never treated as safety clearance.

Triggers are taken from the stated triggering clause rather than a later output-email action. Explicit Outlook/Jira/provider mentions are retained, and generic email is not labeled Gmail. Urgency uses bounded token/phrase matches rather than `down` matching `download`.

Proposed actions determine the generated print-only `.solve` planning script. It contains only fixed labels, never interpolated raw input or external helpers. It is not an implementation of connected automation. JSON export similarly contains the planning result, not the raw support body. Replies no longer claim that a real employee is already investigating.

The route page renders the support demo directly. The obsolete layout that discarded its children is removed along with its hidden email-compose page content.

## Acceptance tests

Fourteen pure regression cases cover the reproduced audit failures, input bounds, non-English/unknown risk, no authorizing result, no fictional provider state and no raw-code interpolation. Browser CI additionally fills the real inputs at three viewport widths, verifies empty/sensitive/compound/provider/trigger behavior, and runs the actual generated script through the pinned canonical WASM Browser Preview. Existing site/navigation/SEO/security tests are retained.

Exact-head CI results, not this document, establish whether a particular revision passes.

## Limits and remaining integration work

These are simple English-language rules, not semantic AI reasoning or a production security classifier. Negation and ambiguous intent can still require clarification. The UI explains these limits and never executes a proposed action. Production needs verified event ingestion, authenticated configuration, tenant-scoped policy, durable deduplication, allowed action adapters, outcome evidence, and a reliable pause/revoke path. No live activation is implied by fixing these previews.
