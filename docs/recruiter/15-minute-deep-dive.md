# 15-Minute Technical Deep Dive

## 0:00-1:30 — Product and maturity framing

Start with the product statement:

> SolveLang is a readable, explainable workflow language designed for AI-assisted business processes.

Then establish boundaries:

- Rust CLI runtime: working today and canonical
- browser preview: working, intentionally smaller subset
- Workflow Intelligence Studio: working local-first deterministic analysis surface
- AI/provider behavior: experimental
- API/account/subscription infrastructure: experimental/test-mode
- full hosted runtime and production integrations: planned

This prevents the rest of the discussion from relying on inflated assumptions.

## 1:30-4:00 — Language pipeline

Walk through:

1. lexer converts source into tokens,
2. parser produces the AST,
3. runtime evaluates statements and expressions,
4. value layer represents language values,
5. diagnostics attach errors to source positions,
6. CLI commands expose validate, run, tokens, and AST inspection.

Discuss runtime semantics such as variables, reassignment, conditionals, loops, functions, arrays, objects, imports, JSON conversion, and source-located runtime errors.

Use `examples/support_triage.solve` as the business-facing example because it is simple enough for a non-language-engineer to understand.

## 4:00-6:30 — Execution safety

Explain the distinction between trusted local execution and hardened modes.

The important design steps are:

- construct execution policy before sensitive runtime work,
- validate explicit JSON input,
- load source and imports under the correct source policy,
- parse and preflight the workflow,
- deny unsafe capabilities before evaluation.

Discuss why deny-before-execution is stronger than relying on unreachable branches not to run.

Mention bounded HTTP behavior and filesystem-root controls for trusted local execution where relevant.

## 6:30-8:30 — AI architecture

Explain that the project contains experimental agent syntax and provider-backed behavior, but model output is treated differently from deterministic workflow rules.

Useful interview discussion:

- why local fallback exists,
- why provider configuration is environment-dependent,
- why hardened execution blocks agent/provider behavior,
- why AI-generated output should not silently mutate business systems,
- how explicit approvals or adapter boundaries could evolve later.

## 8:30-10:30 — Studio and browser architecture

Show how the product has deliberately separate models:

- the browser preview demonstrates a safe subset without pretending to host the Rust runtime,
- Studio models broader workflow concepts for deterministic analysis and simulation,
- Studio-generated `.solve` output is preliminary because the visual workflow model is broader than executable syntax,
- the Rust CLI remains the validator for executable behavior.

Discuss this as an architecture consistency problem rather than hiding it as technical debt.

## 10:30-12:45 — Serverless/API platform work

Describe the experimental stack:

- API Gateway
- Lambda request handlers
- Lambda API-key authorizer
- DynamoDB account/key/usage/idempotency data
- Stripe subscription state
- AWS SAM infrastructure
- test-mode deployment gates

Then tell the authorization debugging story in sequence:

1. API Gateway requests failed before normal authorization results were returned.
2. Direct Lambda behavior showed the authorizer itself could run.
3. A missing Lambda resource policy prevented API Gateway from invoking it reliably.
4. After the invocation permission was corrected, invalid keys correctly failed but valid keys still failed later in the path.
5. Key lookup and last-used updates proved authorization had progressed into usage consumption.
6. Usage metering used DynamoDB transactions, but the role did not include `dynamodb:TransactWriteItems`.
7. The fix granted that action only to the usage and idempotency tables and added regression tests.

This is a strong platform-engineering example because the final solution was not a wildcard permission.

## 12:45-14:00 — Operational/product discipline

Show the status-page model and maturity documentation.

Explain why the project does not invent uptime percentages or fake subscription notifications. Upstream incidents such as GitHub Actions are communicated separately from SolveLang component failures.

Connect this to the broader principle: operational truth is part of product engineering.

## 14:00-15:00 — Strategy and next steps

Close with what you intentionally will not compete on:

- integration count versus Zapier/Make/n8n,
- durable execution versus Temporal,
- batch data orchestration versus Airflow,
- BPMN governance versus enterprise BPM suites.

The intended differentiation is readable, version-controlled workflow intent, deterministic analysis, explicit AI boundaries, and implementation/service workflows.

For next steps, choose one evidence-led capability rather than listing everything: for example, stronger workflow explainability reports, approval primitives, or one execution adapter based on repeated user or consulting demand.