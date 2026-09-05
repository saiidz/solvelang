# Browser parser admission limits

The deny-all WASM wrapper admits at most 1 MiB of source, 1024 lexer tokens (including newline/EOF tokens), and 64 delimiter nesting levels **before recursive parsing**. The token cap also bounds un-delimited unary/operator chains and AST construction; delimiter counting is an admission bound, not syntax validation. The canonical parser still reports malformed syntax within those limits.

This closes a reproduced gap where a 5,000-level nested expression below the source-byte limit caused a JavaScript stack trap instead of the versioned deterministic response. Rejected source returns `limit_exceeded` with no output. Native CLI parsing is unchanged. Existing input/value/output/call-depth/loop/global-work limits remain enforced; the original six generated-WASM limit cases are retained alongside three parser-admission cases.

The browser wrapper deliberately supports a smaller bounded subset. This is not a language-wide size limit, a browser runtime promotion, or a `/run/` replacement. Static artifact qualification, UI loading/fallback, and any public promotion remain separate gates.
