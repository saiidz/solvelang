# Challenges Solved

## Building an understandable interpreter

The project needed more than syntax parsing. It required runtime semantics, values, functions, control flow, imports, diagnostics, and errors that point back to source code rather than failing opaquely.

## Preventing unsafe behavior in advisory execution

A workflow language that can reach files, environment variables, HTTP endpoints, or AI providers needs explicit boundaries. Hardened execution modes and preflight checks were introduced to deny these capabilities before evaluation.

## Preserving deterministic machine-readable output

JSON-mode execution needed strict input validation, bounded file size, supported numeric ranges, typed outputs, and sanitized failures suitable for automation without leaking source or path details.

## Keeping multiple product surfaces honest

The Rust runtime, browser preview, Studio, support demo, and API infrastructure have different capabilities. The project documents those boundaries rather than forcing artificial consistency or implying all surfaces execute the same model.

## Diagnosing API-key authorization failures

A valid API key path failed despite correct key records and subscription state. Investigation isolated two infrastructure problems: missing API Gateway permission to invoke the Lambda authorizer and missing `dynamodb:TransactWriteItems` permission during usage consumption. The fix added narrowly scoped IAM plus regression tests.

## Making an early product credible without fake maturity

Portfolio projects often overclaim. SolveLang instead uses explicit Working Today / Experimental / Planned labels, avoids fabricated uptime and adoption, and treats provider incidents separately from SolveLang component status.

## Finding a defensible market position

The project had to avoid becoming an unfocused automation clone. Competitive analysis reframed it around readable, version-controlled workflow intent and explainability, with mature orchestration platforms treated as possible execution targets rather than enemies to replace.