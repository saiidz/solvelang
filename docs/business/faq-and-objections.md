# Business FAQ and Objection Handling

## “Is SolveLang a Zapier or n8n replacement?”

No. SolveLang is positioned as a readable, explainable workflow language and specification layer. A client implementation may still use Zapier, n8n, Make, Pipedream, Temporal, custom services, or another runtime.

## “Can it run my entire production workflow today?”

Not as a general managed production runtime. The Rust CLI is the canonical local runtime; hosted execution, broad production integrations, and enterprise operations remain planned. Do not sell them as available.

## “Why pay for this if we already have automations?”

The service is useful when existing automations are difficult to understand, review, change, hand off, or govern. The audit should identify whether any work is actually worth changing before implementation begins.

## “Why not just use AI to build the automation?”

AI can accelerate drafting, but generated workflows still need explicit business rules, tool permissions, approval boundaries, failure handling, and human acceptance. SolveLang’s value proposition is readability and reviewability, not replacing accountability with generation.

## “Can you guarantee savings?”

No. ROI estimates depend on client-supplied volumes, labor assumptions, error rates, and validated before/after measurements. Any proposal should distinguish estimates from observed results.

## “Do we need to move off our current tools?”

Usually not. Preserve useful infrastructure. Replace or refactor only where the current system causes measurable risk, cost, or maintenance pain.

## “Can AI make decisions automatically?”

Some low-risk steps may eventually be automated after testing, but consequential actions should have explicitly approved controls. The client owns policy and acceptance criteria.

## “How long does a project take?”

A clarity audit can often be scoped as a short fixed engagement. Prototype and implementation timelines depend on integrations, data access, review requirements, and failure-handling needs. Do not quote a universal delivery time before discovery.

## Objection: “We can document this ourselves.”

Response: “You may be able to, and if the process is already readable and maintainable, you should. The service is most useful when cross-system behavior, AI judgment, ownership, or failure paths are unclear.”

## Objection: “We need automation, not documentation.”

Response: “The documentation is not the end product; it is the acceptance contract for implementation. It reduces the chance of automating the wrong process or hiding important exceptions.”

## Objection: “Your platform is early.”

Response: “That is correct. I would not ask you to depend on an early hosted runtime. The service can use SolveLang as a specification and analysis layer while implementing approved workflows in established tools where appropriate.”

## Objection: “We need enterprise guarantees.”

Response: “SolveLang does not currently claim enterprise orchestration, SLA, or compliance readiness. If those are immediate requirements, the implementation should use a platform that already provides them.”
