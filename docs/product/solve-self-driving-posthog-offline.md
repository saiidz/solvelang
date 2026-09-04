# Solve Self-Driving: Offline PostHog Adapter

The first PostHog integration stage is intentionally an **offline export adapter**, not a live PostHog connection.

It exists to prove that provider-specific product evidence can be transformed into the provider-neutral `solvelang.self-driving.context.v0` contract without granting provider, credential, network, repository-write, rollout-control, or production authority.

## Input contract

The adapter accepts only the versioned schema:

`solvelang.posthog.sanitized-export.v0`

The caller must mark both the export and every record as sanitized. The envelope contains only:

- a non-personal project locator;
- an export locator;
- explicit `complete` or `partial` coverage;
- aggregate skipped-record counts when coverage is partial;
- bounded sanitized records.

Supported record classes are deliberately narrow:

- product event;
- error;
- deployment;
- feature flag;
- experiment;
- AI trace;
- MCP tool call.

Those records map to the existing provider-neutral Solve Context kinds. They do not create a new provider-specific Scout truth model.

## Explicitly rejected data

The offline adapter is not a session-replay or customer-profile ingestion path. It rejects identity/raw-content-shaped fields including:

- PostHog/person distinct IDs;
- person/user/profile IDs;
- email, phone, IP, session, and recording identifiers;
- session recordings/replay payloads;
- request or response bodies;
- raw bodies;
- raw prompt/completion content;
- headers and cookies;
- unexpected provider fields;
- credential-shaped metadata and common secret-shaped values rejected by the downstream Solve Context contract.

The adapter also rejects nested/unbounded metadata through the same scalar dimension and numeric metric restrictions used by Solve Context.

## Coverage and partiality

A `complete` export may not declare skipped records.

A `partial` export must declare bounded aggregate skipped-record counts using one of these reasons:

- `provider-redacted`;
- `unsupported-record`;
- `outside-window`;
- `export-truncated`.

Provider-export partiality and downstream Context signal truncation remain distinct in the adapter result. A partial export is never silently upgraded to complete evidence.

## Authority boundary

The adapter records all of the following as unavailable:

- live PostHog API/SDK access;
- API keys or other provider credentials;
- network access;
- person/profile identity access;
- session replay access;
- raw request/response body access;
- raw prompt access;
- repository write access;
- rollout/feature-flag mutation;
- production mutation;
- external side effects.

Only `observe` mode is accepted.

This stage does **not** install PostHog, connect a project, poll PostHog in the background, open a pull request, change a feature flag, deploy code, or register/provision Solve Runners.

A future live PostHog adapter would require a separate design and review covering least-privilege read-only API scope, credential storage, tenant/project binding, pagination, rate limits, retention, redaction before durable evidence, and proof that no mutation endpoint is invoked.
