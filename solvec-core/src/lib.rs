#![forbid(unsafe_code)]
//! Dependency-minimal, host-incapable SolveLang language core.
//!
//! Host-capable runtime, filesystem/module loading, HTTP, environment,
//! provider, process, and CLI code remain in the native `solvec` crate.
//!
//! Native-only modules are absent from the core public API:
//!
//! ```compile_fail
//! use solvec_core::ai;
//! ```
//!
//! ```compile_fail
//! use solvec_core::ast_runtime;
//! ```
//!
//! ```compile_fail
//! use solvec_core::module_resolver;
//! ```

pub mod ast;
pub mod diagnostics;
pub mod formatter;
pub mod lexer;
pub mod lint;
pub mod parser;
pub mod semantic;
pub mod value;

#[cfg(test)]
mod tests {
    use crate::{diagnostics, formatter, lexer, parser, value::Value};

    #[test]
    fn core_exposes_parse_format_diagnostic_and_value_contract() {
        let source = "let value=1\nprint(value)\n";
        let formatted = formatter::format_source(source);
        assert_eq!(formatted, "let value = 1\nprint(value)\n");
        assert!(diagnostics::validate_source(&formatted).is_ok());
        let mut parser = parser::Parser::new(lexer::lex(&formatted));
        assert_eq!(parser.parse().expect("formatted source parses").len(), 2);
        assert!(Value::Number(1).is_truthy());
    }
}
