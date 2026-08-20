//! Shared canonical language APIs for the CLI and future editor tooling.
//!
//! This crate intentionally exposes the existing lexer, parser, diagnostics,
//! formatter, semantic checker, and AST runtime without adding a second
//! interpreter or changing CLI behavior.

pub mod ai;
pub mod ast;
pub mod ast_runtime;
pub mod diagnostics;
pub mod formatter;
pub mod lexer;
pub mod lint;
pub mod parser;
pub mod semantic;
pub mod value;

#[cfg(test)]
mod tests {
    use crate::{diagnostics, formatter, lexer, parser};

    #[test]
    fn public_language_apis_share_parser_formatter_and_diagnostics() {
        let source = "let value=1\nprint(value)\n";
        let formatted = formatter::format_source(source);
        assert_eq!(formatted, "let value = 1\nprint(value)\n");
        assert!(diagnostics::validate_source(&formatted).is_ok());
        let mut parser = parser::Parser::new(lexer::lex(&formatted));
        assert_eq!(parser.parse().expect("formatted source parses").len(), 2);
    }
}
