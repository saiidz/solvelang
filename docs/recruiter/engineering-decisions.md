# Engineering Decisions

## Keep the Rust CLI canonical

The browser preview and Studio are useful product surfaces, but executable language behavior remains anchored in the Rust runtime. This avoids accidentally treating a simplified UI implementation as the language specification.

## Prefer explicit capability policy

Sensitive operations are controlled through execution policy and preflight checks. Hardened modes are intentionally restrictive and reject conflicting allow flags.

## Treat AI as a different class of behavior

Model-backed output is experimental and variable. Deterministic workflow rules and Studio analysis are kept conceptually separate so users can reason about which decisions are reproducible.

## Make diagnostics part of the product

Source-located errors, snippets, carets, and hints are not incidental developer conveniences; they are central to making a small language usable and explainable.

## Avoid pretending every workflow needs a native integration

The strategy favors SolveLang as a readable specification/explainability layer that may target n8n, Pipedream, Temporal, custom services, or other platforms later. Rebuilding mature connector ecosystems would be low-leverage.

## Keep API permissions scoped

When the authorizer required `TransactWriteItems`, the permission was added only for the two usage-related DynamoDB tables. API Gateway invocation permission was likewise scoped to the authorizer resource rather than granted broadly.

## Separate presentation from proof

A polished support-triage page can explain a future workflow shape, but executable proof comes from the current Rust example and CLI. Documentation explicitly distinguishes these surfaces.

## Delay managed execution claims

Hosted full-runtime execution introduces security, secrets, tenancy, reliability, observability, billing, incident response, and compliance burdens. The roadmap treats managed execution as later work rather than using marketing copy to outrun the architecture.

## Prefer service-first revenue

The strategy recommends workflow audits and implementation services before broad SaaS investment. The product roadmap should be informed by repeated delivery problems rather than hypothetical feature lists.