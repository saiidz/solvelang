# SolveLang Demo Experience

This directory defines the canonical presentation flow for SolveLang. It does not create new product capabilities.

## Demo principle

Show proof in this order:

1. Explain the business problem.
2. Show readable workflow source.
3. Run the canonical Rust CLI.
4. Show a failure or safety boundary.
5. Show the browser/Studio surfaces as derived experiences.
6. End with what is experimental and planned.

## Canonical scenario

Use customer support triage because it is concrete, deterministic, and already represented in the repository.

Canonical executable source:

`examples/support_triage.solve`

Canonical commands:

```bash
cd solvec
cargo run -- validate ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

## Expected deterministic result

The exact formatting is controlled by the current example, but the important demonstrated decisions are:

- urgent ticket -> escalate today
- billing topic -> finance operations owns the case

Do not claim that a live inbox, CRM, Slack channel, or ticketing platform is connected unless such an integration has actually been configured and tested for the demo environment.

## Surfaces

### Canonical runtime

Rust CLI in `solvec/`. This is executable proof.

### Browser preview

`/run/` supports a smaller browser-safe subset and does not call a server.

### Workflow Intelligence Studio

`/studio/` is local-first and uses deterministic analysis. Its broader workflow model is not identical to executable SolveLang syntax.

### Support triage presentation

`/demo/support-triage/` explains the business process and intended automation design. It is not evidence that every represented integration is live.

## Demo labels

Use these exact labels when helpful:

- **Working today** — reproducible in the current repository.
- **Preview** — functioning but intentionally narrower than the canonical runtime.
- **Experimental** — implemented but unstable, provider-dependent, or not suitable for production claims.
- **Planned** — roadmap only.

## Never claim during the demo

- production managed workflow hosting
- enterprise SLA or compliance readiness
- thousands of integrations
- customer adoption or revenue unless independently documented
- benchmark or reliability numbers that have not been measured
- autonomous consequential decisions without human controls

See `docs/demo-status.md` for the detailed maturity inventory.
