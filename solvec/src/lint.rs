//! Read-only, high-confidence lint warnings for parsed SolveLang programs.
//!
//! Lint intentionally reports only structural facts. It never evaluates values,
//! resolves capabilities, or changes the execution policy.

use crate::ast::{ExportedDeclaration, Expr, ExprKind, SourceLocation, Stmt};

#[derive(Clone, Debug, PartialEq)]
pub struct Warning {
    pub line: usize,
    pub column: usize,
    pub message: String,
    pub hint: String,
}

impl Warning {
    fn at(location: SourceLocation, message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self {
            line: location.line,
            column: location.column,
            message: message.into(),
            hint: hint.into(),
        }
    }
}

/// Returns source-located warnings without executing the workflow.
pub fn lint(statements: &[Stmt]) -> Vec<Warning> {
    let mut linter = Linter {
        warnings: Vec::new(),
    };
    linter.lint_block(statements);
    linter.warnings
}

struct Linter {
    warnings: Vec<Warning>,
}

impl Linter {
    fn lint_block(&mut self, statements: &[Stmt]) {
        let mut terminated = false;
        for statement in statements {
            if terminated {
                self.warnings.push(Warning::at(
                    statement_location(statement),
                    "unreachable statement",
                    "Remove this statement or move it before the preceding return, break, or continue.",
                ));
            }

            self.lint_statement(statement);
            terminated |= statement_terminates(statement);
        }
    }

    fn lint_statement(&mut self, statement: &Stmt) {
        match statement {
            Stmt::Let { value, .. }
            | Stmt::Assign { value, .. }
            | Stmt::Print { value, .. }
            | Stmt::Return { value, .. }
            | Stmt::Expr(value) => self.lint_expr(value),
            Stmt::If {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                self.lint_expr(condition);
                self.lint_block(then_branch);
                self.lint_block(else_branch);
            }
            Stmt::While {
                condition, body, ..
            } => {
                self.lint_expr(condition);
                self.lint_block(body);
            }
            Stmt::For { iterable, body, .. } => {
                self.lint_expr(iterable);
                self.lint_block(body);
            }
            Stmt::Function { body, .. }
            | Stmt::Export {
                declaration: ExportedDeclaration::Function { body, .. },
                ..
            } => self.lint_block(body),
            Stmt::Export {
                declaration: ExportedDeclaration::Let { value, .. },
                ..
            } => self.lint_expr(value),
            Stmt::Ask {
                message, location, ..
            } => {
                self.warnings.push(Warning::at(
                    *location,
                    "agent invocation may use an external AI provider",
                    "Use a hardened run for advisory-only evaluation, or review the configured provider before running.",
                ));
                self.lint_expr(message);
            }
            Stmt::Break { .. }
            | Stmt::Continue { .. }
            | Stmt::Agent { .. }
            | Stmt::LegacyInclude { .. }
            | Stmt::ModuleImport { .. }
            | Stmt::NamedModuleImport { .. } => {}
        }
    }

    fn lint_expr(&mut self, expr: &Expr) {
        match &expr.kind {
            ExprKind::Array(values) => {
                for value in values {
                    self.lint_expr(value);
                }
            }
            ExprKind::Object(entries) => {
                for value in entries.values() {
                    self.lint_expr(value);
                }
            }
            ExprKind::Property(object, _) => self.lint_expr(object),
            ExprKind::Index(collection, index) => {
                self.lint_expr(collection);
                self.lint_expr(index);
            }
            ExprKind::Unary { expr, .. } => self.lint_expr(expr),
            ExprKind::Binary { left, right, .. } => {
                self.lint_expr(left);
                self.lint_expr(right);
            }
            ExprKind::Call { name, args } => {
                if let Some((message, hint)) = capability_warning(name) {
                    self.warnings
                        .push(Warning::at(expr.location, message, hint));
                }
                for arg in args {
                    self.lint_expr(arg);
                }
            }
            ExprKind::ModuleCall { args, .. } => {
                for arg in args {
                    self.lint_expr(arg);
                }
            }
            ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => {
            }
        }
    }
}

fn statement_terminates(statement: &Stmt) -> bool {
    match statement {
        Stmt::Return { .. } | Stmt::Break { .. } | Stmt::Continue { .. } => true,
        Stmt::If {
            then_branch,
            else_branch,
            ..
        } => {
            !else_branch.is_empty()
                && then_branch.last().is_some_and(statement_terminates)
                && else_branch.last().is_some_and(statement_terminates)
        }
        _ => false,
    }
}

fn statement_location(statement: &Stmt) -> SourceLocation {
    match statement {
        Stmt::LegacyInclude { location, .. }
        | Stmt::ModuleImport { location, .. }
        | Stmt::NamedModuleImport { location, .. }
        | Stmt::Export { location, .. }
        | Stmt::Let { location, .. }
        | Stmt::Assign { location, .. }
        | Stmt::Print { location, .. }
        | Stmt::Return { location, .. }
        | Stmt::Function { location, .. }
        | Stmt::If { location, .. }
        | Stmt::While { location, .. }
        | Stmt::For { location, .. }
        | Stmt::Break { location }
        | Stmt::Continue { location }
        | Stmt::Agent { location, .. }
        | Stmt::Ask { location, .. } => *location,
        Stmt::Expr(expr) => expr.location,
    }
}

fn capability_warning(name: &str) -> Option<(&'static str, &'static str)> {
    match name {
        "http_get" | "http_post" => Some((
            "network-capable builtin 'http_get' or 'http_post'",
            "Hardened execution denies network calls; review the destination before an unhardened run.",
        )),
        "read_file" | "write_file" => Some((
            "filesystem-capable builtin 'read_file' or 'write_file'",
            "Hardened execution denies file access; review paths before an unhardened run.",
        )),
        "env" => Some((
            "environment-capable builtin 'env'",
            "Hardened execution denies environment reads; avoid exposing secrets in workflow output.",
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::lint;
    use crate::{lexer, parser::Parser};

    fn parse(source: &str) -> Vec<crate::ast::Stmt> {
        Parser::new(lexer::lex(source))
            .parse()
            .expect("parse succeeds")
    }

    #[test]
    fn reports_only_structural_unreachable_and_capability_warnings() {
        let warnings = lint(&parse(
            "return 1\nprint(\"unreachable\")\nhttp_get(\"https://example.invalid\")\n",
        ));

        assert_eq!(warnings.len(), 3);
        assert_eq!(warnings[0].line, 2);
        assert!(warnings[0].message.contains("unreachable"));
        assert_eq!(warnings[1].line, 3);
        assert!(warnings[1].message.contains("unreachable"));
        assert_eq!(warnings[2].line, 3);
        assert!(warnings[2].message.contains("network-capable"));
    }

    #[test]
    fn reports_statements_after_if_with_two_terminating_branches() {
        let warnings = lint(&parse(
            "if input.done { return 1 } else { return 2 }\nprint(\"unreachable\")\n",
        ));

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].line, 2);
        assert_eq!(warnings[0].column, 1);
        assert_eq!(warnings[0].message, "unreachable statement");
    }

    #[test]
    fn does_not_assume_an_if_without_two_terminating_branches_stops_execution() {
        let warnings = lint(&parse("if input.done { return 1 }\nprint(\"reachable\")\n"));

        assert!(warnings.is_empty());
    }

    #[test]
    fn lints_capability_calls_inside_exported_declarations() {
        let warnings = lint(&parse(
            "export let response = http_get(\"https://example.invalid\")\nexport fn save() { return write_file(\"result.txt\", \"value\") }\n",
        ));

        assert_eq!(warnings.len(), 2);
        assert_eq!(warnings[0].line, 1);
        assert!(warnings[0].message.contains("network-capable"));
        assert_eq!(warnings[1].line, 2);
        assert!(warnings[1].message.contains("filesystem-capable"));
    }
}
