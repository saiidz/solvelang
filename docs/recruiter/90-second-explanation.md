# 90-Second Project Explanation

SolveLang is an early Rust-based workflow language for readable, explainable AI-assisted business processes.

The idea came from a gap I kept seeing between visual automation tools and general-purpose code. Visual tools are easy to start with but can become hard to review, version, and audit. Traditional code is powerful, but the business process can disappear inside implementation detail. SolveLang explores a middle layer where the workflow itself stays readable.

Technically, I built the canonical runtime in Rust with a lexer, parser, AST, interpreter, imports, functions, arrays, objects, JSON helpers, runtime diagnostics, and explicit safety policies. Hardened modes can fail closed around network access, file I/O, environment variables, imports, and experimental agent/tool behavior.

I also built a local-first Workflow Intelligence Studio in TypeScript/Next.js for deterministic workflow modeling and analysis, plus a limited browser preview. Separately, I prototyped test-mode API-key, usage, account, and Stripe subscription infrastructure on AWS.

One thing I care about in the project is truthful maturity. The CLI runtime is the canonical implementation. AI behavior and API infrastructure are experimental, and managed production execution is planned rather than claimed.

The project demonstrates language engineering, AI workflow design, cloud/platform engineering, security, full-stack product work, and the ability to translate technical systems into business-process tooling.