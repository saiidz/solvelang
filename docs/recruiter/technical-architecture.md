# Technical Architecture Summary

## Overview

SolveLang is a multi-surface early product built around a canonical Rust runtime.

```text
.solve source
   |
   v
Rust lexer -> parser -> AST -> runtime
   |                    |
   |                    +-> diagnostics / execution policy / built-ins
   |
   +-> validate / tokens / ast / run CLI commands

Web surfaces
   +-> Browser preview: deliberately smaller client-side subset
   +-> Workflow Intelligence Studio: local-first deterministic modeling/analysis
   +-> Demo and documentation pages
   +-> Account/API-key/subscription UI (experimental/test-mode)

Cloud/API access (experimental/test-mode)
   +-> API Gateway
   +-> Lambda handlers / Lambda authorizer
   +-> DynamoDB account, key, usage and idempotency data
   +-> Stripe subscription integration
   +-> AWS SAM infrastructure and deployment gates
```

## Canonical runtime

The Rust CLI in `solvec/` is the source of truth for executable language behavior. It depends on and re-exports the host-incapable lexer, parser, AST, values, and diagnostics owned by `solvec-core/`, while native runtime evaluation, AI provider code, CLI parsing, input handling, import loading, and execution policy remain in `solvec/`.

## Safety model

Trusted local execution can expose file, environment, network, and experimental agent/provider capabilities. Hardened modes build a restrictive policy and preflight the workflow before evaluation. The design goal is to deny sensitive capabilities before a branch is executed rather than relying on the workflow to avoid them at runtime.

## Browser preview

The `/run` browser experience is a safe static preview and supports a smaller language subset. It does not represent a hosted Rust runtime. This intentional mismatch is documented so the product can demonstrate the language without making a false hosting claim.

## Workflow Intelligence Studio

Studio is a local-first browser application for modeling and deterministic workflow analysis. Its workflow model is broader than executable language syntax. Generated `.solve` output is therefore treated as a preliminary draft that should be validated by the Rust CLI.

## API access

The API-access service is experimental/test-mode infrastructure. It includes account and API-key logic, authentication/authorization, subscription state, credits/usage, AWS infrastructure, and Stripe integration. It is useful platform-engineering proof but should not be described as a production public API runtime.

## Operational status

The status page separates component health from upstream dependencies such as GitHub Actions. The first version is manually maintained and intentionally does not fabricate historical uptime.

## Engineering themes demonstrated

- compiler/interpreter pipeline
- runtime semantics and diagnostics
- fail-closed capability policy
- local-first product architecture
- frontend/backend maturity boundaries
- serverless authentication and IAM
- transactional usage metering
- payment/subscription integration
- testing and CI/CD
- incident and dependency communication
