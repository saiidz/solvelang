# SolveLang current-main security review — 2026-09-13

This review is repository evidence only. It does not certify production infrastructure, provider credentials, live billing, deployed controls, or customer data handling outside the checked source tree.

## Scope

The review began from `main` after launch-readiness reconciliation PR #876 and focused on browser/server rendering boundaries that can turn structured application data into executable HTML or script context. The review also preserves the existing authority rule: repository fixes may merge after exact-head qualification, but production/provider/billing mutations remain separately owner-controlled.

## Validated finding: inline JSON-LD script termination

`site/app/components/JsonLd.tsx` previously inserted `JSON.stringify(data)` directly through `dangerouslySetInnerHTML` into an `application/ld+json` script element. JSON string escaping does not neutralize the HTML parser's `</script>` end tag. If a future JSON-LD field ever contains attacker-controlled or insufficiently trusted text, a value containing `</script>` could terminate the JSON-LD block and inject markup/script into the surrounding document.

The current call sites are primarily product/SEO structured data, so this review does not claim a known production exploit path. The boundary itself was nevertheless unsafe and unnecessarily depended on every future caller remaining trusted.

## Fix

- route all JSON-LD output through a dedicated serializer;
- escape `<`, `>`, `&`, U+2028, and U+2029 as JSON Unicode escapes before insertion into the script element;
- preserve JSON semantics so consumers recover the original structured-data values;
- normalize an `undefined` root input to JSON `null` instead of emitting an undefined HTML payload;
- add a hostile regression using a literal `</script><script>...` payload and verify that the serialized text contains no HTML-significant script terminator while `JSON.parse` restores the original value.

## Evidence boundary

This fix addresses one validated source-level rendering boundary. It is not a whole-product security certification. Dependency audit, authn/authz, billing ownership, webhook ordering, provider isolation, recovery controls, CI security lanes, and production infrastructure each retain their own evidence and owner/external gates.

Further repository-safe review should continue independently across monitoring/incident/disable-path truth, release controls, and remaining current-main trust boundaries.
