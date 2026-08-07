# Lessons Learned

## Product maturity must be represented in architecture and language

Calling something "experimental" only in marketing copy is not enough. The project is stronger when runtime boundaries, deployment gates, UI labels, and documentation all agree.

## AI should not erase deterministic reasoning

A model can help classify, summarize, or draft, but business actions still need explicit ownership, approvals, and failure behavior. The architecture is clearer when deterministic rules and model-driven behavior are represented separately.

## Security bugs often live at boundaries

The API-key incident was not caused by key hashing or subscription lookup. It occurred at service boundaries: API Gateway invoking Lambda and Lambda transacting with DynamoDB. End-to-end debugging matters more than inspecting one component in isolation.

## Least privilege requires knowing the exact runtime path

Generic CRUD permissions did not cover the DynamoDB transaction API used by usage metering. IAM should be derived from actual operations and resources rather than assumed from broad policy names.

## A polished demo is not the same as executable proof

Presentation pages are useful for product storytelling, but the best engineering portfolio distinguishes mock/preview surfaces from the canonical implementation.

## Documentation is architecture work

A repository map, maturity model, demo-status guide, and business examples reduce ambiguity for contributors and reviewers. Good documentation exposes boundaries and tradeoffs rather than only listing commands.

## The best roadmap includes things not to build

SolveLang becomes more credible when it explicitly avoids competing with connector marketplaces, durable workflow engines, data orchestrators, and enterprise BPM suites where established products are already stronger.

## Services can validate product direction faster than speculative SaaS

Using workflow audits and implementation work as an early revenue path creates opportunities to observe repeated problems before investing in expensive managed infrastructure.