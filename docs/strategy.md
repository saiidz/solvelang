# SolveLang Strategy

_Last updated: 2026-08-06._

## Strategic premise

SolveLang should become valuable before it becomes large.

The near-term objective is not to build a universal automation platform. It is to turn an existing technical prototype into a credible portfolio, a repeatable consulting method, and a focused product direction.

The positioning is:

> **SolveLang is a readable, explainable workflow language designed for AI-assisted business processes.**

The operating model is:

1. make workflow intent readable and reviewable,
2. separate deterministic logic from AI-assisted judgment,
3. validate and explain safety boundaries,
4. use existing platforms when they are the right execution environment,
5. productize repeated consulting patterns over time.

## Mission

Help technical teams, operators, and consultants describe AI-assisted business processes in a form that humans can read, engineers can review, and organizations can audit.

## Vision

A future in which business workflows are not trapped inside screenshots, visual canvases, proprietary exports, or undocumented application code.

SolveLang should become a portable explanation and design layer for workflows: one source-controlled definition that communicates intent, AI boundaries, tools, approvals, expected outputs, and failure behavior.

This vision does not require SolveLang to execute every workflow itself. The most credible long-term architecture may allow approved SolveLang definitions to target existing runtimes and integration platforms.

## Principles

### Readable

A workflow should communicate its purpose without requiring the reader to reverse-engineer framework plumbing.

### Version controllable

Workflow changes should be diffable, reviewable, attributable, and reversible.

### Human understandable

A process owner should be able to discuss the workflow with an engineer, even when the owner cannot implement the runtime.

### AI friendly

The language should be easy for AI systems to explain, draft, validate, and transform, while never treating generated output as automatically correct.

### Auditable

The workflow should expose decision points, tool access, data movement, approvals, and failure paths.

### Maintainable

Reusable components, clear naming, diagnostics, tests, and documentation are more important than clever syntax.

### Composable

Small validated workflows and modules should combine into larger processes without hiding their behavior.

## Product truth model

Every public document and interface should classify capabilities using these labels.

### Working today

Supported by the repository and manually or automatically testable now.

Current examples include:

- the Rust lexer, parser, AST, and interpreter prototype
- CLI run, validate, tokens, AST, and help commands
- variables, conditions, loops, functions, arrays, objects, imports, JSON helpers, and diagnostics documented in the language reference
- source-located runtime errors
- hardened execution modes that restrict sensitive capabilities
- a local-first deterministic Workflow Intelligence Studio
- a smaller browser-safe `/run` preview
- repository examples, documentation, tests, and launch-readiness controls

### Experimental

Implemented but unstable, narrow, provider-dependent, or unsuitable for production promises.

Current examples include:

- HTTP helpers
- file and environment helpers
- AI agent syntax
- local AI fallback behavior
- optional OpenAI-backed responses
- draft generation from the broader Studio model
- test-mode API access, customer accounts, and subscription infrastructure

### Planned

A direction or roadmap item without a working implementation.

Examples include:

- stable language specification
- full hosted Rust runtime
- production integrations
- managed workflow execution
- runtime adapters for established orchestration platforms
- broader AI-provider support
- production packaging and releases
- enterprise governance and durability

No planned capability should be written as if it exists.

## Ideal users

### Primary: technical founders and hands-on operators

Characteristics:

- own internal processes across several SaaS tools
- understand the business problem but may not want a large custom application
- need better documentation and control than ad hoc automation provides
- are willing to work with a technical consultant

Best initial problems:

- support intake and triage
- lead qualification and routing
- approval workflows
- document classification
- recurring operational reports
- human-reviewed AI summarization

### Primary: automation consultants and small agencies

Characteristics:

- implement workflows in n8n, Make, Zapier, Pipedream, custom code, or mixed environments
- need a consistent discovery and documentation method
- struggle with handoff, maintenance, and scope control
- benefit from reusable examples and audit artifacts

SolveLang can become their specification and explanation layer, even when another platform executes the final workflow.

### Secondary: engineering teams evaluating AI-assisted workflows

Characteristics:

- care about Git, review, tests, safety boundaries, and observability
- want deterministic logic separated from model behavior
- may use LangGraph, OpenAI Agents SDK, Temporal, Airflow, or internal services

SolveLang should help them prototype intent and produce review artifacts, not demand replacement of their runtime.

### Secondary: recruiters and hiring managers

They are not product users, but they are an important audience for the repository. They should be able to verify that the founder can:

- design and implement a language runtime
- work in Rust and TypeScript
- build APIs and cloud infrastructure
- reason about security and IAM
- design AI-assisted workflows
- write tests and diagnostics
- communicate architecture and tradeoffs
- convert technical work into product and business strategy

## Users SolveLang should not target first

- nontechnical consumers seeking one-click personal automations
- enterprises requiring certified production orchestration immediately
- data teams seeking a replacement for Airflow
- backend teams seeking a replacement for Temporal
- organizations selecting a BPMN standard suite
- buyers whose main requirement is thousands of connectors
- teams expecting autonomous AI workers without human governance

## Unique value proposition

### Core value proposition

> Define business-process logic, AI-assisted decisions, tools, approvals, and safety boundaries in readable source-controlled workflows.

### Why that matters

Visual automations are quick to build but can be hard to review and maintain. General-purpose code is powerful but often hides process intent behind implementation detail. Agent frameworks enable complex AI behavior but are primarily designed for engineers.

SolveLang aims to occupy the middle layer:

- simpler than a full application codebase
- more reviewable than a visual canvas
- more explicit than an autonomous agent prompt
- lighter than enterprise BPM suites
- portable across implementation choices over time

### Defensible near-term differentiation

- language implementation rather than only UI configuration
- deterministic analysis and explicit safety modes
- human-readable process source
- source-level diagnostics
- local-first workflow analysis
- clear maturity labels
- service-first implementation path

## Product architecture strategy

### Layer 1: language and static understanding

Purpose:

- parse and validate workflow source
- expose readable diagnostics
- model deterministic control flow
- identify AI, tool, data, and approval boundaries
- generate explanation and evidence artifacts

Priority: highest.

### Layer 2: trusted local execution

Purpose:

- run prototype workflows through the Rust CLI
- preserve explicit safety modes
- support deterministic examples
- keep side effects controlled and documented

Priority: high, but production claims remain prohibited.

### Layer 3: Studio and derived views

Purpose:

- visualize workflows
- run deterministic analysis
- simulate scenarios
- review traces and quality indicators
- export evidence

Rule: the visual view is derived from explicit workflow definitions and analysis; it should not replace the source of truth.

### Layer 4: provider and platform adapters

Possible future targets:

- OpenAI Agents SDK
- n8n
- Pipedream
- Temporal
- Airflow
- custom HTTP services

Priority: only after service work proves repeated demand.

### Layer 5: managed hosted execution

Possible future purpose:

- authenticated workflow execution
- managed secrets and connections
- usage metering
- logs and traces
- team environments
- deployment controls

Priority: later. This layer has the highest security, reliability, compliance, and operational burden and should not be rushed.

## 90-day roadmap

The roadmap is organized by outcomes, not feature volume.

### Days 1–30: make the project understandable and demonstrable

**Portfolio**

- rewrite the README around the new positioning
- add exact current-maturity labels
- publish a recruiter-first navigation path
- document architecture and repository structure
- remove unsupported marketing language

**Demo**

- define what works today, preview, experimental, and planned
- choose one canonical support-triage demo
- create a 90-second and 5-minute walkthrough
- capture required screenshots and expected outputs

**Examples**

- standardize examples around problem, input, workflow, output, explanation, business value, and limitations
- validate every executable example with the canonical CLI

**Business**

- define one entry offer: workflow discovery and explainability audit
- define scope, deliverables, timeline, price hypothesis, and exclusions

**Success criteria**

- a new visitor understands SolveLang in under 10 seconds
- a developer can run the canonical demo in under 15 minutes
- a recruiter can find technical proof without reading the whole repository
- no roadmap item is presented as available

### Days 31–60: turn the repository into a service-delivery asset

**Consulting assets**

- create discovery questionnaire
- create current-state workflow inventory template
- create risk and AI-boundary checklist
- create implementation proposal template
- create 30-day delivery plan

**Developer experience**

- improve CLI help and onboarding gaps discovered during documentation work
- standardize terminology and folder naming
- improve error messages only where reproducible friction exists

**Evidence**

- produce architecture diagrams
- document engineering decisions and tradeoffs
- publish sample audit deliverables using fictional data

**Outbound**

- create a small list of founder-led outreach targets
- offer a fixed-scope pilot rather than a software subscription

**Success criteria**

- one complete fictional client engagement can be demonstrated end to end
- every service deliverable maps to a repository artifact
- the founder can explain the project at 90-second, 5-minute, and 15-minute depths

### Days 61–90: validate demand and productize repetition

**Customer discovery**

- conduct targeted interviews with technical founders, agencies, and operations teams
- record problems, current tools, maintenance pain, buying authority, and willingness to pay
- avoid counting compliments as demand

**Paid pilot goal**

- sell a workflow audit, documentation sprint, or prototype implementation
- collect permission before publishing any case study
- measure time spent and reusable assets created

**Product decisions**

- identify repeated needs across engagements
- prioritize one narrow reusable capability
- reject features that only serve one hypothetical buyer

**Success criteria**

- at least one paid or clearly budgeted pilot, or an explicit conclusion that the offer needs repositioning
- documented evidence for the next product investment
- a backlog ordered by observed demand rather than speculation

## 12-month roadmap

### Quarter 1: credibility and first service offer

- complete portfolio, demo, recruiter, business, and open-source packets
- establish canonical examples
- validate API-access test infrastructure without production claims
- launch workflow audit and implementation services

### Quarter 2: repeatable service delivery

- deliver small projects using existing client platforms
- use SolveLang definitions as specifications and handoff artifacts
- build reusable templates for common business processes
- document anonymized patterns and lessons
- improve validation and explanation based on real delivery friction

### Quarter 3: first narrow productization

Choose only one based on evidence, such as:

- workflow explainability report generator
- visual-flow-to-readable-specification service
- deterministic AI-boundary auditor
- approved workflow template pack
- adapter for one execution platform

Do not launch multiple product lines.

### Quarter 4: evaluate managed product economics

- measure service revenue, delivery time, repeated requests, support burden, and hosting risk
- decide whether to remain service-led, offer paid developer tooling, or build a narrow hosted product
- create production-readiness criteria before exposing managed execution
- pursue partnerships with automation agencies or implementation firms if useful

## Revenue roadmap

### Stage 1: fixed-scope services

The first revenue should come from expertise, not subscription software.

#### Workflow clarity audit

Possible scope:

- interview stakeholders
- inventory current process and tools
- identify failure points and manual work
- separate deterministic and AI-assisted decisions
- produce readable workflow specification
- produce risk and implementation recommendations

Initial pricing hypothesis: a fixed fee based on scope, not an hourly public rate. The business packet should test ranges rather than present unvalidated prices as established market rates.

#### Workflow prototype sprint

Possible scope:

- one approved use case
- one SolveLang specification
- one implementation prototype in an agreed platform
- test cases and failure paths
- documentation and handoff

#### Automation rescue and documentation

For organizations with fragile Zapier, Make, or n8n workflows:

- inventory existing automation
- document hidden assumptions
- identify duplicated logic and unsafe AI steps
- recommend simplification
- produce maintenance documentation

### Stage 2: implementation and retainers

#### Implementation package

- build or refactor workflows using the client's chosen tools
- use SolveLang artifacts for specification and review
- include acceptance criteria, tests, and rollback plan

#### Monthly maintenance

- monitor failures
- review changes
- update documentation
- control model and automation costs
- perform quarterly workflow audits

### Stage 3: reusable paid assets

Potential products after demand validation:

- industry workflow packs
- audit templates
- implementation accelerators
- CI validation tools
- report generators
- private training and workshops

### Stage 4: narrow SaaS or managed developer tool

Only pursue when repeated service work demonstrates:

- a frequent problem
- a consistent buyer
- measurable value
- manageable support burden
- safe and economical hosting
- a reason existing platforms cannot solve it adequately

## Service packaging principles

- Sell outcomes and deliverables, not "AI transformation."
- Use fixed scope and explicit exclusions.
- Require a human approval owner for consequential decisions.
- Prefer the client's existing tools when appropriate.
- Never promise full automation before observing the process.
- Include failure handling and maintenance in every implementation plan.
- Document model, platform, and usage costs separately.

## Technical roadmap

### Immediate

- preserve parser/runtime correctness
- maintain fail-closed safety behavior
- keep executable examples validated
- improve status labeling and documentation
- stabilize test-mode API authorization and billing infrastructure
- document the boundary between Studio and canonical runtime

### Near term

- improve static analysis around AI and side-effect boundaries
- define a minimal workflow explanation schema
- improve deterministic report export
- strengthen examples and tests
- document compatibility guarantees and known gaps
- create architecture decision records for major changes

### Evidence-led future

- typed workflow interfaces
- explicit approval primitives
- provider-neutral AI step declarations
- trace and evidence schema
- adapter interface for external runtimes
- one validated execution adapter
- packaging and release automation

### Later, only with readiness criteria

- hosted full runtime
- managed connections and secrets
- team workspaces
- deployment environments
- production observability
- billing and quotas
- support and incident procedures
- compliance work

## Marketing roadmap

### Foundation

- honest README
- clear website hero
- current-status page
- canonical demo
- architecture diagram
- recruiter packet
- consulting packet

### Content themes

1. Why visual automations become hard to maintain.
2. How to separate business rules from AI judgment.
3. How to review workflows in Git.
4. How to document failure and approval paths.
5. How to choose between Zapier, n8n, Temporal, Airflow, and agent frameworks.
6. Building an interpreter and safety model in Rust.
7. Honest lessons from AI-assisted product development.

### Distribution

- GitHub repository and releases
- founder LinkedIn posts
- technical architecture articles
- short demo videos
- implementation case studies with permission
- targeted outreach to agencies and technical founders
- relevant open-source communities without spam

### Proof hierarchy

Marketing claims should use the strongest available proof in this order:

1. reproducible test or command
2. source code and documentation
3. screenshot or recorded demo
4. anonymized client result with permission
5. customer quote with permission

Never substitute aspirational copy for proof.

## Portfolio strategy

SolveLang should demonstrate senior-level work across multiple dimensions.

### Language engineering

- lexer, parser, AST, interpreter
- diagnostics
- imports and runtime semantics
- language reference and examples

### Systems and platform engineering

- Rust runtime
- API design
- AWS SAM infrastructure
- DynamoDB consistency and transactions
- IAM least privilege
- CI/CD and test-mode gates

### AI engineering

- explicit agent syntax
- provider adapters
- guardrails and safety boundaries
- deterministic versus model-driven behavior
- usage and cost awareness

### Product engineering

- local-first Studio
- user-facing examples
- status and maturity design
- demo experience
- documentation architecture

### Technical product and consulting

- competitive analysis
- roadmap prioritization
- service packaging
- ROI reasoning
- discovery and implementation methodology

## Hiring-position alignment

### AI engineer / AI automation engineer

Emphasize workflow modeling, provider integration, safety, evaluation boundaries, prompt/tool declarations, and cost-aware execution.

### Software engineer

Emphasize Rust, parser/runtime design, tests, diagnostics, APIs, TypeScript, and architecture.

### Platform engineer

Emphasize IAM, DynamoDB transactions, serverless deployment, fail-closed configuration, observability plans, and runtime boundaries.

### Solutions engineer / implementation engineer

Emphasize translating business processes into technical systems, demos, integration strategy, scoping, and handoff.

### Developer relations

Emphasize language design communication, examples, onboarding, docs, demos, and open-source readiness.

### Technical product manager

Emphasize market mapping, truth-based maturity labels, roadmap tradeoffs, service-led validation, and measurable milestones.

## Decision framework for new features

Before accepting a feature, answer:

1. Which validated user problem does it solve?
2. Is the need about description, analysis, execution, or operations?
3. Does an established platform already solve the runtime problem better?
4. Can SolveLang integrate instead of duplicate?
5. What new security or support burden appears?
6. How will the feature be tested and demonstrated?
7. Is it working, experimental, or planned?
8. Does it strengthen the portfolio, consulting offer, or validated product path?
9. Can it be delivered in a small reviewable PR?

Reject or defer work that cannot answer these questions.

## Key risks

### Scope expansion

Risk: trying to become a language, IDE, SaaS automation platform, agent framework, BPM suite, and consulting business simultaneously.

Control: one primary positioning and one narrow outcome per PR.

### Marketing ahead of reality

Risk: portfolio copy creates expectations the runtime cannot satisfy.

Control: status labels, reproducible demos, and explicit limitations.

### Building infrastructure before demand

Risk: expensive hosted execution consumes time and money without customers.

Control: service-first validation and readiness gates.

### AI unpredictability

Risk: agent behavior is presented as deterministic.

Control: explicit AI steps, constrained tools, human approvals, validation, and failure paths.

### Founder time fragmentation

Risk: too many parallel projects and open branches reduce delivery quality.

Control: sequential mission PRs, small scope, and merge-before-next discipline.

## Metrics

Do not use vanity metrics as proof of product-market fit.

### Portfolio metrics

- time for a new visitor to understand the project
- time for a developer to run the demo
- number of reproducible examples
- documentation completeness
- test reliability
- recruiter conversations where SolveLang becomes a substantive talking point

### Service metrics

- qualified discovery calls
- proposals sent
- paid pilots
- average delivery time
- gross margin after model/platform costs
- percentage of deliverables reused
- maintenance or follow-on work

### Product-validation metrics

- repeated pain across separate customers
- repeated request for the same artifact or capability
- active use after delivery
- measurable reduction in manual work or errors
- willingness to pay without custom persuasion

## 12-month strategic outcome

A successful year does not require SolveLang to become a large SaaS.

A credible successful outcome is:

- a polished and technically deep public repository
- a clear, honest product position
- a set of reproducible demos and examples
- recruiter-ready architecture and interview material
- at least one validated consulting offer
- paid implementation or audit work
- evidence identifying one narrow product opportunity
- a disciplined roadmap that avoids competing with established platforms on their strongest dimensions

That outcome would already make SolveLang a meaningful career asset and a foundation for a sustainable business.
