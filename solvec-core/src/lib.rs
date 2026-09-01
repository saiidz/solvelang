#![forbid(unsafe_code)]
//! Dependency-minimal, host-incapable SolveLang language core.
//!
//! This first extraction stage deliberately shares the already-reviewed pure
//! source modules with the native `solvec` crate. Host-capable runtime,
//! filesystem/module loading, HTTP, environment, provider, process, and CLI
//! code are not compiled into this crate.

#[path = "../../solvec/src/ast.rs"]
pub mod ast;
#[path = "../../solvec/src/diagnostics.rs"]
pub mod diagnostics;
#[path = "../../solvec/src/formatter.rs"]
pub mod formatter;
#[path = "../../solvec/src/lexer.rs"]
pub mod lexer;
#[path = "../../solvec/src/lint.rs"]
pub mod lint;
#[path = "../../solvec/src/parser.rs"]
pub mod parser;
#[path = "../../solvec/src/semantic.rs"]
pub mod semantic;
#[path = "../../solvec/src/value.rs"]
pub mod value;

#[cfg(test)]
mod tests {
    use crate::{diagnostics, formatter, lexer, parser, value::Value};

    #[test]
    fn core_exposes_shared_parse_format_diagnostic_and_value_contract() {
        let source = "let value=1\nprint(value)\n";
        let formatted = formatter::format_source(source);
        assert_eq!(formatted, "let value = 1\nprint(value)\n");
        assert!(diagnostics::validate_source(&formatted).is_ok());
        let mut parser = parser::Parser::new(lexer::lex(&formatted));
        assert_eq!(parser.parse().expect("formatted source parses").len(), 2);
        assert!(Value::Number(1).is_truthy());
    }
}
