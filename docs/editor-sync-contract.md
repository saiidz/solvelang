# Bounded editor synchronization

`solvelsp` accepts versioned `didOpen`, monotonically newer `didChange` with exactly one full-text replacement, and `didClose`. It advertises full-document sync (LSP kind 1), not range-edit sync. Older/equal versions and duplicate opens cannot replace cached source. Diagnostics carry the accepted document version. Closing clears source and version state; later changes require reopening.

The open-document index is limited to 64 entries, each at most 64 KiB, 512 lexer tokens, 64 delimiter nesting levels, and a 4096-byte confined local-file URI. A newer unsupported/range or over-budget change invalidates the old cached source and emits a bounded diagnostic; navigation never silently uses that obsolete text. Documents outside these editor limits can still use the explicit CLI; editor acceptance is not language validity.

Stdio headers are bounded to 8 KiB and bodies to 1 MiB. Oversized framing terminates the connection rather than treating an unread body as more headers. Existing deterministic cross-file navigation only consults opened documents and preserves export, shadowing, path, and UTF-16 rules.

No workspace crawl, dependency installation, source execution, provider/network access, agent/tool call, or source mutation is introduced. Rename/application, workspace-wide references/diagnostics, and asynchronous cancellation/debouncing remain separate unimplemented slices; this change does not claim them complete.
