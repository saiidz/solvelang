# Engineering Quality Audit

_Last updated: 2026-08-06._

This audit separates **confirmed behavior**, **engineering risk**, and **planned improvement**. It does not treat an early-beta design choice as a defect merely because a more mature product would use a different architecture.

## Executive summary

SolveLang already demonstrates unusually broad engineering surface area for an early project: a Rust lexer/parser/AST runtime, diagnostics, runtime-safety policy, a browser preview, a deterministic local-first Studio, a Next.js site, and experimental AWS/SAM API/account infrastructure.

The highest-value next quality work is not adding more features. It is reducing semantic drift between execution surfaces, keeping security controls explicit, consolidating validation workflows, and decomposing the largest runtime modules only when tests make the refactor safe.

## Severity model

- **P0** — confirmed security/data-loss/availability defect requiring immediate action.
- **P1** — high-risk correctness/security issue or prerequisite for a public capability.
- **P2** — meaningful maintainability, testing, operational, or performance risk.
- **P3** — developer-experience or cleanup improvement.

No P0 issue is asserted by this document without reproducible evidence.

---

## 1. API authorizer deployment permissions

**Status:** confirmed historical defect with an open fix path.

**Severity:** P1 for the experimental hosted API path.

The API-key authorizer debugging work identified two infrastructure permission gaps: API Gateway invocation permission for the Lambda authorizer and `dynamodb:TransactWriteItems` permission for usage/idempotency accounting. The fix is isolated in PR #88 and was locally validated with API-access tests plus SAM validation/build.

**Risk:** until the infrastructure fix is merged and deployed to the intended test stack, a valid key can fail authorization/usage consumption even when key lookup and subscription checks succeed.

**Recommendation:** merge/validate PR #88 separately before treating test-mode API authorization as healthy. Keep the permission scoped to the authorizer ARN and the two usage tables; do not replace it with wildcard DynamoDB access.

**Boundary:** this affects experimental/test-mode API access, not the local Rust CLI.

---

## 2. Canonical Rust runtime versus browser preview

**Status:** intentional architecture with drift risk.

**Severity:** P2.

The Rust CLI is canonical, while `/run/` implements a deliberately smaller browser-safe subset in a separate browser runner.

**Risk:** as syntax evolves, a duplicated parser/interpreter surface can silently diverge in accepted syntax, errors, or semantics.

**Recommendation:**

1. keep the preview subset explicitly documented;
2. add shared fixture-based compatibility tests for syntax intentionally supported by both runtimes;
3. make unsupported syntax fail clearly;
4. avoid expanding the preview ad hoc until a compatibility strategy exists.

Do not describe this as duplicate “dead code”; the preview has a real product purpose.

---

## 3. Studio model versus executable language

**Status:** intentional architecture with translation risk.

**Severity:** P2.

Workflow Intelligence Studio models triggers, approvals, policies, exceptions, timers, notifications, systems, and evidence beyond what the executable language currently supports.

**Risk:** users can mistake a Studio representation or generated `.solve` draft for executable parity.

**Existing mitigation:** current documentation states that generated scripts are preliminary and the Rust CLI is the canonical validator/runtime.

**Recommendation:**

- preserve unsupported concepts as explicit comments/evidence during export;
- keep deterministic export tests;
- show a machine-readable compatibility/maturity label in generated artifacts when practical;
- never silently drop unsupported workflow concepts.

---

## 4. Runtime maintainability hotspots

**Status:** maintainability risk, not a confirmed correctness bug.

**Severity:** P2.

`solvec/src/main.rs` and `solvec/src/ast_runtime.rs` are currently large modules carrying multiple responsibilities.

`main.rs` includes CLI parsing, execution-policy construction, JSON input loading, import loading, preflight behavior, and command dispatch. `ast_runtime.rs` contains substantial evaluation and built-in behavior.

**Risk:** future changes become harder to review and increase the chance of unrelated regressions.

**Recommendation:** only after coverage is strong, extract responsibility-focused modules such as:

- `cli/args`
- `cli/input`
- `source/imports`
- `policy/preflight`
- runtime built-in groups

Keep refactors behavior-preserving and separate from feature PRs.

---

## 5. Security boundary clarity

**Status:** positive architecture with ongoing regression risk.

**Severity:** P1/P2 depending on capability.

The runtime has explicit hardened modes and rejects capability-enabling flags when hardened execution is active. HTTP limits, filesystem-root restrictions, import restrictions, sanitized JSON failures, and environment/AI capability controls are documented.

**Risk:** adding a new built-in or side-effect path without wiring it into preflight/policy checks could bypass the intended fail-closed model.

**Recommendation:** require every new side-effecting built-in to include:

- capability classification;
- hardened-mode behavior;
- preflight coverage;
- runtime coverage;
- documentation update;
- negative tests proving denial.

A contributor checklist should treat this as a merge requirement.

---

## 6. API keys and secrets in demos/support workflows

**Status:** operational security risk common to troubleshooting workflows.

**Severity:** P1 process risk.

API-key troubleshooting can encourage copying credentials into terminals, screenshots, issue comments, or chat logs.

**Recommendation:**

- never ask users to paste complete keys into issues, docs, screenshots, or chat;
- show only prefixes/suffixes after creation;
- document immediate revocation for exposed test keys;
- keep secret scanning enabled where repository settings allow it;
- sanitize demo capture checklists.

The recruiter/demo packet already recommends redaction; keep this consistent across support docs.

---

## 7. Validation workflow fragmentation

**Status:** developer-experience/testing risk.

**Severity:** P2/P3.

Validation currently spans multiple subsystem commands:

### Rust runtime

```bash
cd solvec
cargo test
```

### Site / Studio

```bash
cd site
npm run lint
npm run test:studio
npm run build
```

### API access

```bash
cd services/api-access
npm test
sam validate --lint --template template.yaml
sam build --template template.yaml
```

**Risk:** contributors can run only the tests nearest their change and miss cross-surface breakage.

**Recommendation:** eventually add one documented root-level verification command or CI composite workflow that calls the canonical subsystem gates without hiding their output.

Do not create a wrapper that silently installs dependencies, changes AWS state, or deploys resources.

---

## 8. CI dependency and outage handling

**Status:** known upstream operational dependency.

**Severity:** P2 operational risk.

GitHub Actions outages can prevent webhook-triggered checks from starting even when local code is valid. The 2026-08-06 GitHub incident affected both hosted and self-hosted runners and webhook throughput.

**Recommendation:**

- retain reproducible local validation commands;
- record local evidence when upstream CI cannot run;
- rerun required CI after recovery before merge where repository policy requires it;
- use `/status/` to distinguish upstream CI/deployment degradation from runtime/product outages.

Do not weaken branch protections permanently to work around a temporary vendor incident.

---

## 9. Manual status reporting

**Status:** intentionally manual first version.

**Severity:** P2 if the hosted product becomes operationally important; P3 today.

The public status page deliberately avoids fake uptime metrics and fake subscriptions.

**Risk:** manual component state can become stale.

**Recommendation:** before claiming measured uptime, add independent health checks with timestamped observations and a clear retention/aggregation method. Add subscriber notifications only when consent, delivery, and unsubscribe flows are real.

---

## 10. Performance

**Status:** no benchmark claim available.

**Severity:** P3 today.

There is not enough evidence to assert a runtime performance problem. Avoid speculative optimization.

Potential future measurements, only when needed:

- lexer/parser time by fixture size;
- runtime time for deterministic workflows;
- Studio analysis time by node/edge count;
- browser-preview responsiveness;
- API authorization latency and DynamoDB transaction cost in the test environment.

Benchmarks should record hardware/environment, fixture, commit SHA, and methodology before they become public claims.

---

## 11. Dead code and duplication policy

**Status:** requires evidence before deletion.

**Severity:** P3.

Do not remove code merely because a symbol looks unused across one search result. Rust compiler warnings, TypeScript/ESLint output, route references, tests, and generated/static-export behavior should be checked first.

Recommended process:

1. run compiler/linter/test gates;
2. search references;
3. classify generated or route-discovered code correctly;
4. remove dead code in a dedicated cleanup PR;
5. verify output and bundle behavior before/after.

---

## 12. Configuration consistency

**Status:** incremental improvement opportunity.

**Severity:** P3.

The repository contains Rust, Next.js/TypeScript, Node API, AWS SAM, and operational configuration. A single universal configuration format is neither realistic nor desirable.

**Recommendation:** standardize only cross-cutting conventions:

- maturity labels;
- environment-variable naming and documentation;
- secret handling;
- test versus production naming;
- commands in contributor docs;
- error terminology.

Avoid cosmetic folder moves that create large diffs without reducing ambiguity.

---

# Priority backlog

## P1

1. Merge and validate the scoped API-authorizer IAM fix before relying on test-mode hosted authorization.
2. Maintain fail-closed regression tests whenever side-effecting runtime capabilities are added.
3. Keep API-key handling/redaction guidance explicit in support and demo workflows.

## P2

4. Add shared compatibility fixtures between canonical Rust syntax and the intentional browser subset.
5. Add explicit compatibility evidence for Studio-to-`.solve` export.
6. Consolidate top-level verification orchestration without hiding subsystem gates.
7. Decompose large Rust runtime modules only through behavior-preserving, well-tested PRs.
8. Add independent status measurement before publishing uptime history.

## P3

9. Run periodic dead-code/configuration cleanup using compiler/linter evidence.
10. Add benchmarks only after a product question requires them.
11. Continue accessibility and copy consistency audits across secondary site routes.

# Quality gate for future PRs

Every future feature PR should answer:

- What maturity label does this capability have?
- What is the canonical implementation?
- What tests prove the happy path?
- What tests prove failure/denial behavior?
- Does it add a side effect or new secret?
- Does hardened execution need to change?
- Does documentation need to change?
- Does a browser/Studio representation need compatibility coverage?
- Is the change independently deployable/reversible?
- Are any public claims introduced, and what evidence supports them?

This checklist is intentionally stricter than “the demo works.” It is meant to keep SolveLang credible as both an engineering portfolio and a future business.
