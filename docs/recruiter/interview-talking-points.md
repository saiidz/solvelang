# Interview Talking Points

## The core story

SolveLang began as a language/runtime problem, but the deeper engineering question became how to make AI-assisted workflows understandable and safe enough to review. The project therefore spans parsing, execution, diagnostics, browser tooling, cloud infrastructure, and product boundaries.

## Strong technical themes

### 1. Language implementation

Talk about the lexer, parser, AST, runtime values, control flow, functions, imports, diagnostics, and the decision to keep the Rust CLI as the canonical runtime.

### 2. Safety as policy, not a warning banner

Hardened modes deny network, file, environment, agent/tool, unsafe import, and mutation-style behavior before execution. The important point is architectural: safety restrictions are enforced in runtime policy and preflight rather than relying only on documentation.

### 3. Deterministic versus AI-driven behavior

The project deliberately does not call deterministic Studio analysis "AI analysis." Experimental provider-backed behavior is separated from deterministic business rules. This is a useful discussion for AI-engineering interviews because model output should not silently become business action.

### 4. API authorization debugging

A useful platform-engineering story is the API-key authorizer incident. The request path initially failed because API Gateway lacked a persistent Lambda invocation permission; after that was corrected, valid keys still failed because usage metering required `dynamodb:TransactWriteItems`, which was not included in the authorizer role. The fix added scoped IAM permissions and regression tests instead of broad wildcards.

### 5. Honest product boundaries

The browser preview intentionally supports less than the Rust runtime. Studio's model is broader than executable SolveLang syntax. API/subscription infrastructure is experimental/test-mode. These boundaries are documented rather than hidden.

### 6. Product strategy

Competitive research showed that SolveLang should not compete with Zapier on integrations, Temporal on durable execution, Airflow on data orchestration, or BPMN suites on enterprise process management. The proposed niche is readable, source-controlled workflow intent and explainability.

## Role-specific emphasis

### AI engineer

Emphasize deterministic/model boundaries, provider integration, guardrails, tools, usage cost awareness, and human approval.

### Software engineer

Emphasize Rust, parser/runtime implementation, diagnostics, tests, error handling, and API/web architecture.

### Platform engineer

Emphasize AWS SAM, Lambda, API Gateway, DynamoDB transactions, IAM least privilege, failure analysis, test-mode deployment gates, and operational status design.

### Solutions / implementation engineer

Emphasize business-process mapping, translating requirements into deterministic rules and integration boundaries, and using existing platforms rather than forcing replacement.

### DevRel

Emphasize language docs, examples, quick starts, demo narration, contributor onboarding, maturity labels, and explaining technical tradeoffs clearly.

### Technical product

Emphasize competitive analysis, roadmap decisions, what not to build, service-first revenue, and evidence-led productization.

## Questions to be ready for

- Why create a language instead of a library or YAML schema?
- Why Rust?
- Why is the browser preview intentionally smaller?
- How do hardened execution modes work?
- What parts are production ready today? Answer: do not claim the project has a production hosted workflow runtime.
- What would you build next and why?
- What did you decide not to build?
- What is the hardest bug or infrastructure issue you diagnosed?
- How would this integrate with n8n, Temporal, OpenAI Agents SDK, or existing enterprise systems?
- What would have to change before managed hosted execution could be called production ready?