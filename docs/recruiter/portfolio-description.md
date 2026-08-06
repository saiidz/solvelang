# Portfolio Description

## Short version

**SolveLang** is an early Rust-based language and workflow-analysis project for readable, explainable AI-assisted business processes. It combines language implementation, runtime safety, local-first workflow analysis, web product surfaces, and experimental cloud/API infrastructure while keeping current, experimental, and planned capabilities clearly separated.

## Portfolio version

SolveLang explores a simple question: how can business workflows remain understandable when deterministic rules, AI-assisted decisions, tools, approvals, and external systems are mixed together?

Instead of starting with another drag-and-drop automation builder, SolveLang starts with readable source. The canonical runtime is an early Rust interpreter with a lexer, parser, AST runtime, imports, functions, arrays, objects, JSON helpers, HTTP/file/environment capabilities, source-located diagnostics, and explicit hardened execution modes. A local-first Workflow Intelligence Studio provides deterministic workflow modeling, simulation, analysis, traces, and evidence export. The web project also contains a deliberately limited browser preview plus experimental account, API-key, subscription, and usage infrastructure.

The engineering emphasis is on explicit boundaries: deterministic logic versus model output, trusted local execution versus hardened execution, presentation pages versus executable proof, and experimental cloud infrastructure versus production readiness.

The project demonstrates language/runtime engineering, platform and cloud engineering, AI workflow design, developer tooling, full-stack product work, security reasoning, documentation, competitive analysis, and service-oriented product strategy.

## What makes it a strong interview project

SolveLang is not impressive because it claims scale. It is useful because the repository exposes real engineering tradeoffs:

- designing and evolving a language runtime,
- deciding what should fail closed,
- building understandable diagnostics,
- handling AI capabilities without implying determinism,
- securing serverless authorizers and usage transactions,
- separating browser previews from canonical execution,
- documenting experimental versus planned product surfaces,
- and deciding when not to build features that mature platforms already solve better.