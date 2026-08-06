# SolveLang Status Page Operations

The public status page lives at `/status/` and is intentionally conservative.

## Purpose

The page exists to communicate:

- current SolveLang component state;
- upstream dependency incidents that materially affect SolveLang;
- incident updates and recovery notes;
- the maturity of components that are still experimental or test-mode;
- what is and is not independently monitored.

It is not a marketing uptime page.

## Current reporting model

Status reporting is manual.

The page must not publish:

- fabricated uptime percentages;
- backfilled historical availability;
- invented SLA claims;
- unverified incident causes;
- production labels for experimental/test-mode systems.

Until independent monitoring exists, components that cannot be measured objectively should use `not_monitored` and explain the limitation.

## Source file

Operational state is defined in:

```text
site/app/(english)/status/status-data.ts
```

The UI is defined in:

```text
site/app/(english)/status/page.tsx
```

## Component states

Supported states are:

- `operational`
- `degraded`
- `partial_outage`
- `major_outage`
- `maintenance`
- `not_monitored`

Use the least dramatic state supported by evidence. Do not mark a component operational merely because no one has reported a problem.

## Incident lifecycle

Supported incident states are:

- `investigating`
- `identified`
- `monitoring`
- `resolved`

A typical incident sequence is:

```text
investigating → identified → monitoring → resolved
```

Not every incident requires every stage.

## Upstream incidents

SolveLang depends on external services such as GitHub and cloud/payment providers.

When an upstream incident affects SolveLang:

1. identify the affected SolveLang component;
2. mark that component degraded/outage only when the dependency materially affects it;
3. state that the incident is upstream;
4. link to the provider's official status page;
5. describe SolveLang-specific impact rather than copying the provider's entire incident feed;
6. resolve the SolveLang incident only after the relevant impact is no longer present.

Example: a GitHub Actions outage can degrade CI/deployment without implying the public website or local Rust CLI is unavailable.

## Updating an incident

Add a new update at the beginning of the incident `updates` array so the newest information appears first.

Use UTC ISO 8601 timestamps:

```text
2026-08-06T22:18:00Z
```

Each update should answer:

- what changed;
- what remains affected;
- what SolveLang users/contributors should expect.

Avoid speculative root causes.

## Resolving an incident

When resolved:

- change the incident state to `resolved`;
- add `resolvedAt`;
- add a final update explaining the restored behavior;
- return affected components to the correct current state;
- do not delete the incident simply because it is over.

## Future automated monitoring

Independent uptime reporting is **planned**, not working today.

A future monitoring system should ideally measure at least:

- website reachability;
- browser preview page reachability;
- Studio page reachability;
- authenticated API health only after the API is genuinely operated as a supported service;
- account/billing health only after those systems have production support boundaries.

Only after real measurements are stored should the page show 30/60/90-day uptime percentages.

## Subscription notifications

Email/SMS incident subscriptions are not implemented today. Do not display a `Subscribe` control until there is a real notification backend and consent/unsubscribe flow.

## Validation

For status-page changes:

```bash
cd site
npm run lint
npm run test:studio
npm run build
```

Review the rendered `/status/` page at desktop and mobile widths before deployment.
