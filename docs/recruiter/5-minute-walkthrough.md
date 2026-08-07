# 5-Minute Interview Walkthrough

## 0:00-0:45 — Position the project

"SolveLang is a readable workflow language for AI-assisted business processes. The goal is not to replace Zapier or Temporal. It is to make workflow intent, AI boundaries, tools, approvals, and failure behavior understandable and reviewable."

Clarify maturity immediately: the Rust CLI is canonical, Studio and browser surfaces are useful product layers, AI behavior is experimental, and managed hosted execution is planned.

## 0:45-1:45 — Show the language/runtime

Open `examples/support_triage.solve` and explain the business rule in plain language before discussing syntax.

Then run:

```bash
cd solvec
cargo run -- validate ../examples/support_triage.solve
cargo run -- run ../examples/support_triage.solve
```

Point out the lexer/parser/AST/runtime pipeline and the source-located diagnostics.

## 1:45-2:45 — Explain the safety model

Show hardened execution documentation or a safe-mode command. Explain that sensitive capabilities are denied through execution policy and preflight rather than merely discouraged in documentation.

Key point: network, files, environment access, imports, and agent/tool behavior have explicit boundaries.

## 2:45-3:30 — Show the product surfaces

Open the browser preview and explain that it deliberately implements a smaller subset.

Then show Workflow Intelligence Studio and explain that it is local-first and deterministic. Its broader workflow model is not automatically equivalent to executable SolveLang syntax.

This demonstrates a product decision: keep the user experience useful without hiding technical boundaries.

## 3:30-4:20 — Explain platform engineering

Describe the experimental API-access stack: API Gateway, Lambda, Lambda authorizer, DynamoDB, AWS SAM, account/API-key logic, usage metering, and Stripe subscription infrastructure.

Use the IAM debugging story: API Gateway invocation permission and `TransactWriteItems` were two separate failures. The final fix used scoped permissions and tests.

## 4:20-5:00 — Close on product judgment

Explain what you deliberately did not build:

- a giant connector marketplace,
- a Temporal replacement,
- a BPMN suite,
- a fake production hosted runtime.

Close with the service-first strategy: use SolveLang to support workflow discovery, audits, implementation, and handoff, then productize only repeated problems.