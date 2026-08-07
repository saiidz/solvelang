# Resume Bullets

Use only bullets that fit the role and can be defended in an interview. Avoid copying all of them into one resume.

## Software / platform engineering

- Designed and implemented an early Rust interpreter for SolveLang, including lexer, parser, AST runtime, imports, runtime diagnostics, arrays, objects, functions, loops, JSON helpers, and explicit execution policies.
- Built source-located validation and runtime errors with line, column, source snippets, and actionable hints to improve developer debugging and language usability.
- Added hardened execution modes that fail closed around network access, file I/O, environment access, agent/tool calls, unsafe imports, and mutation-style capabilities.
- Implemented deterministic JSON input/output contracts for advisory workflow execution, including strict input-size and numeric-bound validation and sanitized machine-readable errors.
- Built and tested AWS SAM serverless infrastructure for API access, authentication, subscription state, usage metering, and least-privilege IAM around Lambda and DynamoDB.
- Diagnosed an API Gateway/Lambda authorizer failure across IAM invocation permissions and DynamoDB transaction permissions, then added regression coverage for the corrected security boundaries.

## AI engineering / automation

- Designed SolveLang as a readable workflow language for AI-assisted business processes, separating deterministic business rules from experimental model-driven behavior.
- Implemented experimental agent syntax and optional OpenAI-backed responses while preserving explicit local fallback behavior and non-production maturity labels.
- Designed safety boundaries so model or tool capability is denied in hardened execution modes before workflow evaluation.
- Built a deterministic local-first Workflow Intelligence Studio for workflow modeling, static analysis, simulation, traces, quality review, and evidence export without presenting deterministic analysis as AI inference.

## Full-stack / product engineering

- Built Next.js and TypeScript product surfaces for workflow previews, Studio, account/API-key flows, subscription management, demos, and operational status communication.
- Created a browser-safe SolveLang preview that executes a deliberately smaller syntax subset without a hosted server runtime and clearly communicates that boundary in the UI.
- Implemented customer-facing API-key and subscription infrastructure in test mode using AWS services and Stripe, with explicit maturity labels and deployment gates.
- Added a truthful public status-page model that distinguishes SolveLang component health from upstream provider incidents and intentionally avoids fabricated uptime history.

## Developer experience / DevRel

- Reworked repository onboarding around a 15-minute contributor path, subsystem ownership, validation matrices, maturity labels, and small reviewable pull requests.
- Authored language references, runtime-safety documentation, business workflow examples, demo-readiness guidance, architecture/navigation docs, and competitive strategy.
- Standardized portfolio examples around problem, input, workflow, output, expected behavior, limitations, screenshots, and demo narration.

## Solutions / implementation engineering

- Modeled business processes such as support triage, lead qualification, CRM handoff, invoice review, operations reporting, email summarization, document classification, and approvals while explicitly separating implemented logic from planned integrations.
- Positioned SolveLang as a specification and explainability layer that can complement existing automation and orchestration tools rather than requiring customers to replace them.
- Developed a service-first roadmap around workflow discovery, explainability audits, implementation prototypes, documentation, and maintenance before pursuing broader SaaS execution.

## Technical product

- Conducted competitive analysis across workflow automation, orchestration, BPM, coding-agent, and AI-agent platforms to identify a differentiated position centered on readable, version-controlled, auditable workflow definitions.
- Defined a 90-day and 12-month roadmap that prioritizes demonstrability, consulting revenue, repeated customer problems, and evidence-led productization over speculative feature volume.