//! Native SolveLang host/runtime façade.
//!
//! Pure language APIs are owned by `solvec-core` and re-exported here so
//! existing `solvec::ast`, `solvec::parser`, `solvec::formatter`, and
//! related callers keep the same public paths. Host-capable adapters stay
//! in this native crate.

pub mod ai;
pub mod ast_runtime;
pub mod module_resolver;
mod native_host;

pub use solvec_core::{ast, diagnostics, formatter, lexer, lint, parser, semantic, value};

#[cfg(test)]
mod tests {
    use crate::{diagnostics, formatter, lexer, parser};

    #[test]
    fn native_facade_reexports_core_language_apis() {
        let source = "let value=1\nprint(value)\n";
        let formatted = formatter::format_source(source);
        assert_eq!(formatted, "let value = 1\nprint(value)\n");
        assert!(diagnostics::validate_source(&formatted).is_ok());
        let mut parser = parser::Parser::new(lexer::lex(&formatted));
        assert_eq!(parser.parse().expect("formatted source parses").len(), 2);
    }
}
