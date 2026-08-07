# SolveLang search query map

_Last verified: 2026-08-06._

This map is a content and measurement plan. It does not contain search-volume or ranking estimates.

| Query group | Searcher intent | Best existing page | Missing page / gap | Direct answer | Supporting evidence | Desired conversion | Type |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SolveLang brand | Understand what the project is | `/`, `/about/` | None | SolveLang is a readable, explainable workflow language designed for AI-assisted business processes. | `README.md`, `docs/strategy.md`, brand facts | Read docs / GitHub | Navigational + informational |
| SolveLang maturity | Determine whether it is production-ready | `/about/`, `/status/`, README | Keep maturity copy synchronized | SolveLang is an early beta. Local Rust execution works today; managed production workflow execution is planned. | README, demo status, status page | Evaluate safely | Informational |
| Install SolveLang | Run the project locally | README / GitHub | A dedicated public getting-started HTML page would improve citation eligibility | Clone the repository and use the Rust CLI in `solvec/`. | README, language reference | Clone repository | Technical |
| SolveLang CLI | Understand `run`, `validate`, `tokens`, `ast` | README, language reference | Dedicated CLI HTML documentation | The Rust CLI is the canonical validator and runtime. | `solvec/src/main.rs`, language reference | Run example | Technical |
| `.solve` syntax | Learn supported language syntax | Language reference / resources | Public versioned syntax pages | Current syntax includes variables, conditions, loops, functions, arrays, objects, imports, JSON helpers, and documented experimental capabilities. | language reference | Read reference | Technical |
| Safe mode | Understand security boundaries | Runtime safety docs | Public HTML safety page | Hardened modes deny network, file, environment, AI/tool, and mutation-style capabilities before evaluation. | runtime safety, CLI tests | Run safe example | Informational + technical |
| SolveLang vs Zapier | Compare workflow approaches | `/`, strategy/competitive analysis | Public comparison article based only on factual category differences | SolveLang is not a connector-first no-code platform; it focuses on readable source-controlled workflow intent. | competitive analysis, README | Evaluate fit | Comparison |
| SolveLang vs n8n | Compare workflow approaches | `/`, n8n tools, competitive analysis | Public comparison article | n8n is a technical automation runtime/platform; SolveLang can act as a readable specification/analysis layer and may complement it. | competitive analysis | Try preflight / docs | Comparison |
| SolveLang vs Temporal | Determine durability/runtime fit | competitive analysis | Public comparison article | SolveLang does not replace Temporal durable execution. | competitive analysis | Read architecture | Comparison |
| SolveLang vs agent frameworks | Determine AI orchestration fit | `/about/`, competitive analysis | Public explainer | SolveLang separates business-process intent and AI-assisted judgment instead of acting as a general-purpose multi-agent framework. | strategy, competitive analysis | Read examples | Comparison |
| Browser preview | Understand online execution | `/run/` | None | The browser preview runs a deliberately smaller browser-only subset and does not call a server. | `/run/` source, README | Try preview | Technical |
| Studio | Understand Workflow Intelligence Studio | `/studio/`, `/about/` | Public Studio explainer page | Studio is local-first and its current analysis is deterministic rather than AI analysis. | strategy, Studio docs | Open Studio | Informational |
| Studio privacy | Determine whether workflow data leaves browser | `/preflight-privacy/`, Studio docs | Ensure visible Studio privacy link | Current Studio analysis and browser preflight are designed to operate locally in the browser. | Studio privacy docs, UI | Open Studio | Trust |
| Support triage | Find workflow example | `/demo/support-triage/`, examples | None | SolveLang includes a deterministic support-triage example and a public presentation demo. | `examples/support_triage.solve`, demo docs | Run demo | Use case |
| Lead qualification | Find workflow example | examples/resources | Public dedicated example page could improve discovery | SolveLang can express deterministic lead-routing rules; external CRM writes remain implementation-specific/planned where not connected. | docs/examples | Read example | Use case |
| Approval workflow | Design human-review workflow | docs/examples | Public dedicated example page | SolveLang emphasizes explicit human-review and approval boundaries, but durable production approval orchestration is not claimed. | approval example, strategy | Request workflow audit | Use case |
| Email summarization | Evaluate AI-assisted workflow | docs/examples | Public dedicated example page | AI summarization is an experimental pattern and should be human-reviewed before consequential action. | email summarization example | Read example | Use case |
| Document classification | Evaluate AI-assisted workflow | docs/examples | Public dedicated example page | Semantic classification is experimental/model-dependent and should not silently become a business action. | document classification example | Read example | Use case |
| n8n workflow validation | Validate exported n8n JSON | `/check/`, `/n8n-workflow-validator/` | Keep tools distinct and non-duplicative | The browser preflight performs deterministic checks locally without sending workflow data to a server. | check page source | Run validator | Commercial + technical |
| n8n security scanner | Inspect workflow security signals | `/n8n-security-scanner/` | Keep visible limitations | The tool surfaces deterministic risk signals; it is not a guarantee that a workflow is secure. | public tool page | Run scan | Technical |
| SolveLang API | Determine hosted API availability | `/api-pricing/`, account docs | A dedicated public API status/reference page is needed before production positioning | The repository contains test-mode API-access/account/billing infrastructure; production API availability must be verified independently before being claimed. | API README, status page, brand facts | Read API status | Technical + commercial |
| API pricing | Understand plan screens | `/api-pricing/` | Must stay synchronized with deployed behavior | A pricing screen alone does not prove a production API. Plan limits and status must match deployed documentation. | API service config/docs | Evaluate only if status verified | Commercial |
| MCP | Understand MCP capabilities | README/resources | Dedicated public MCP reference | MCP direction supports inspecting, explaining, validating, and drafting workflows within documented safety limits; it is not full remote runtime execution. | README, MCP server source | Read repository | Technical |
| Pricing / consulting | Understand service offer | `/pricing/`, business docs | Keep price hypotheses separate from established market rates | SolveLang can be used for fixed-scope workflow audits, prototype sprints, implementation, and maintenance; pricing hypotheses require validation. | business packet | Request audit | Commercial |
| Privacy and secrets | Evaluate trust | `/preflight-privacy/`, runtime safety, terms | Public security/limitations page | Public search surfaces must not expose workflow uploads, customer data, API keys, or private account information. | runtime safety, contributor docs | Read safety docs | Trust |
| Status / outages | Determine service health | `/status/` | Future measured uptime only after real monitoring exists | Status reporting is manually maintained today and does not claim measured uptime or an SLA. | status page/docs | Check status | Navigational |
| Roadmap | Understand planned features | README / strategy | Public roadmap HTML page | Stable specification, adapters, managed execution, broader provider support, and enterprise governance remain planned/evidence-led. | strategy, ROADMAP | Follow project | Informational |
| License / source | Determine open-source terms | GitHub, license review | None | The repository uses the license published in `LICENSE`; source is available on GitHub. | `LICENSE`, GitHub | View source | Navigational |
| Contact / support | Reach project | `/support/`, homepage | None | Public support contact is `hello@solve-lang.com`. | brand facts, support page | Contact | Navigational |

## Priority content gaps

1. Public, canonical, versioned Getting Started / CLI documentation in HTML.
2. Public Safety and Limitations page that consolidates runtime, Studio, preview, and API maturity boundaries.
3. Dedicated API reference/status page only after the deployed API state is verified.
4. Dedicated public use-case pages for the strongest examples instead of relying only on repository Markdown.
5. Factual comparison pages only where the comparison can remain current and evidence-backed.

## Synonyms and alternative phrasing

Use naturally where accurate: workflow language, workflow specification language, business workflow scripting, workflow-as-code, workflow analysis, workflow preflight, human-in-the-loop workflow, AI-assisted workflow, auditable automation, source-controlled workflow, business process automation design, n8n workflow validator, workflow safety checker.

Avoid keyword stuffing and avoid describing SolveLang as a no-code automation marketplace, production durable workflow engine, or autonomous AI workforce platform.
