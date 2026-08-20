//! Conservative, non-executing semantic checks for parsed SolveLang programs.
//!
//! The checker reports only facts that follow from the parsed source. Values that
//! can depend on runtime input, calls, or branches stay `Unknown` instead of
//! producing speculative diagnostics.

use std::collections::{BTreeMap, HashMap};

use crate::ast::{BinaryOp, Expr, ExprKind, Stmt};
use crate::diagnostics::Diagnostic;

#[derive(Clone, Debug, PartialEq)]
enum Type {
    Number,
    Text,
    Bool,
    Array(Vec<Type>),
    Object(BTreeMap<String, Type>),
    Unknown,
}

impl Type {
    fn name(&self) -> &'static str {
        match self {
            Self::Number => "number",
            Self::Text => "text",
            Self::Bool => "boolean",
            Self::Array(_) => "array",
            Self::Object(_) => "object",
            Self::Unknown => "unknown value",
        }
    }
}

#[derive(Clone, Debug)]
struct FunctionSymbol {
    arity: usize,
}

/// Checks parsed syntax without evaluating it or selecting an execution policy.
pub fn check(statements: &[Stmt]) -> Result<(), Vec<Diagnostic>> {
    let mut checker = Checker::new(statements);
    checker.check_block(statements, &mut HashMap::new(), false);
    if checker.diagnostics.is_empty() {
        Ok(())
    } else {
        Err(checker.diagnostics)
    }
}

struct Checker {
    functions: HashMap<String, FunctionSymbol>,
    agents: HashMap<String, ()>,
    diagnostics: Vec<Diagnostic>,
}

impl Checker {
    fn new(statements: &[Stmt]) -> Self {
        let mut functions = HashMap::new();
        let mut agents = HashMap::new();
        let mut diagnostics = Vec::new();

        for statement in statements {
            match statement {
                Stmt::Function {
                    name,
                    params,
                    location,
                    ..
                } if functions
                    .insert(
                        name.clone(),
                        FunctionSymbol {
                            arity: params.len(),
                        },
                    )
                    .is_some() =>
                {
                    diagnostics.push(Diagnostic::new(
                        location.line,
                        location.column,
                        format!("duplicate function declaration '{}'", name),
                        "Use a distinct function name; functions cannot be overloaded.",
                    ));
                }
                Stmt::Agent { name, location, .. } if agents.insert(name.clone(), ()).is_some() => {
                    diagnostics.push(Diagnostic::new(
                        location.line,
                        location.column,
                        format!("duplicate agent declaration '{}'", name),
                        "Use a distinct agent name.",
                    ));
                }
                _ => {}
            }
        }

        Self {
            functions,
            agents,
            diagnostics,
        }
    }

    fn error(&mut self, expr: &Expr, message: impl Into<String>, hint: impl Into<String>) {
        self.diagnostics.push(Diagnostic::new(
            expr.location.line,
            expr.location.column,
            message,
            hint,
        ));
    }

    fn check_block(
        &mut self,
        statements: &[Stmt],
        values: &mut HashMap<String, Type>,
        in_function: bool,
    ) {
        for statement in statements {
            match statement {
                Stmt::Let { name, value, .. } => {
                    let value_type = self.check_expr(value, values, in_function);
                    values.insert(name.clone(), value_type);
                }
                Stmt::Assign {
                    name,
                    value,
                    location,
                } => {
                    if !values.contains_key(name) && name != "input" {
                        self.diagnostics.push(Diagnostic::new(
                            location.line,
                            location.column,
                            format!("assignment to unknown variable '{}'", name),
                            "Declare it with 'let' before assigning a value.",
                        ));
                    }
                    let value_type = self.check_expr(value, values, in_function);
                    if values.contains_key(name) {
                        values.insert(name.clone(), value_type);
                    }
                }
                Stmt::Print { value, .. } | Stmt::Return { value, .. } => {
                    self.check_expr(value, values, in_function);
                }
                Stmt::Expr(expr) => {
                    self.check_expr(expr, values, in_function);
                }
                Stmt::If {
                    condition,
                    then_branch,
                    else_branch,
                    ..
                } => {
                    self.check_expr(condition, values, in_function);
                    // Blocks retain runtime variable state. Merge only names whose type agrees
                    // across both paths; all other values become dynamic/unknown.
                    let mut then_values = values.clone();
                    let mut else_values = values.clone();
                    self.check_block(then_branch, &mut then_values, in_function);
                    self.check_block(else_branch, &mut else_values, in_function);
                    for name in then_values.keys().chain(else_values.keys()) {
                        let merged = match (then_values.get(name), else_values.get(name)) {
                            (Some(left), Some(right)) if left == right => left.clone(),
                            _ => Type::Unknown,
                        };
                        values.insert(name.clone(), merged);
                    }
                }
                Stmt::While {
                    condition, body, ..
                } => {
                    self.check_expr(condition, values, in_function);
                    let mut body_values = values.clone();
                    self.check_block(body, &mut body_values, in_function);
                    for name in body_values.keys() {
                        values.entry(name.clone()).or_insert(Type::Unknown);
                    }
                }
                Stmt::For {
                    name,
                    iterable,
                    body,
                    ..
                } => {
                    let iterable_type = self.check_expr(iterable, values, in_function);
                    let item_type = match iterable_type {
                        Type::Array(items) => items
                            .into_iter()
                            .reduce(merge_types)
                            .unwrap_or(Type::Unknown),
                        Type::Unknown => Type::Unknown,
                        other => {
                            self.error(
                                iterable,
                                format!("'for ... in' requires an array, got {}", other.name()),
                                "Use an array value as the loop iterable.",
                            );
                            Type::Unknown
                        }
                    };
                    let mut body_values = values.clone();
                    body_values.insert(name.clone(), item_type);
                    self.check_block(body, &mut body_values, in_function);
                    for name in body_values.keys() {
                        values.entry(name.clone()).or_insert(Type::Unknown);
                    }
                }
                Stmt::Function { params, body, .. } => {
                    let mut function_values = values.clone();
                    for param in params {
                        function_values.insert(param.clone(), Type::Unknown);
                    }
                    self.check_block(body, &mut function_values, true);
                }
                Stmt::Agent { .. } => {}
                Stmt::Ask {
                    agent,
                    message,
                    location,
                } => {
                    self.check_expr(message, values, in_function);
                    if !self.agents.contains_key(agent) {
                        self.diagnostics.push(Diagnostic::new(
                            location.line,
                            location.column,
                            format!("ask references unknown agent '{}'", agent),
                            "Declare the agent before using 'ask'.",
                        ));
                    }
                }
            }
        }
    }

    fn check_expr(
        &mut self,
        expr: &Expr,
        values: &HashMap<String, Type>,
        in_function: bool,
    ) -> Type {
        match &expr.kind {
            ExprKind::Number(_) => Type::Number,
            ExprKind::Text(_) => Type::Text,
            ExprKind::Bool(_) => Type::Bool,
            ExprKind::Variable(name) => match values.get(name) {
                Some(value_type) => value_type.clone(),
                // `input` is supplied only by the CLI, and a function can observe globals
                // that exist at call time. Neither is knowable from source alone.
                None if name == "input" || in_function => Type::Unknown,
                None => {
                    self.error(
                        expr,
                        format!("use of unknown variable '{}'", name),
                        "Declare it with 'let' before reading it.",
                    );
                    Type::Unknown
                }
            },
            ExprKind::Array(items) => Type::Array(
                items
                    .iter()
                    .map(|item| self.check_expr(item, values, in_function))
                    .collect(),
            ),
            ExprKind::Object(entries) => Type::Object(
                entries
                    .iter()
                    .map(|(key, value)| (key.clone(), self.check_expr(value, values, in_function)))
                    .collect(),
            ),
            ExprKind::Property(object, property) => {
                let object_type = self.check_expr(object, values, in_function);
                match object_type {
                    Type::Object(entries) => {
                        entries.get(property).cloned().unwrap_or(Type::Unknown)
                    }
                    Type::Unknown => Type::Unknown,
                    other => {
                        self.error(
                            expr,
                            format!("property access requires an object, got {}", other.name()),
                            "Use '.property' only with an object value.",
                        );
                        Type::Unknown
                    }
                }
            }
            ExprKind::Index(collection, index) => {
                let collection_type = self.check_expr(collection, values, in_function);
                let index_type = self.check_expr(index, values, in_function);
                match collection_type {
                    Type::Array(items) => match index_type {
                        Type::Number => {
                            if let ExprKind::Number(index_value) = index.kind
                                && (index_value < 0 || index_value as usize >= items.len())
                            {
                                self.error(
                                    index,
                                    format!(
                                        "array index {} is out of bounds for an array of length {}",
                                        index_value,
                                        items.len()
                                    ),
                                    "Use an index between 0 and the last array element.",
                                );
                            }
                            Type::Unknown
                        }
                        Type::Unknown => Type::Unknown,
                        other => {
                            self.error(
                                index,
                                format!("array index must be a number, got {}", other.name()),
                                "Use a non-negative numeric array index.",
                            );
                            Type::Unknown
                        }
                    },
                    Type::Object(entries) => match &index.kind {
                        ExprKind::Text(key) => entries.get(key).cloned().unwrap_or(Type::Unknown),
                        _ if index_type == Type::Unknown => Type::Unknown,
                        _ => {
                            self.error(
                                index,
                                "object index must be text",
                                "Use a text key such as object[\"name\"].",
                            );
                            Type::Unknown
                        }
                    },
                    Type::Unknown => Type::Unknown,
                    other => {
                        self.error(
                            expr,
                            format!(
                                "index access requires an array or object, got {}",
                                other.name()
                            ),
                            "Use '[...]' only with an array or object value.",
                        );
                        Type::Unknown
                    }
                }
            }
            ExprKind::Unary { expr: operand, .. } => {
                self.check_expr(operand, values, in_function);
                Type::Bool
            }
            ExprKind::Binary {
                left,
                operator,
                right,
            } => {
                let left_type = self.check_expr(left, values, in_function);
                let right_type = self.check_expr(right, values, in_function);
                match operator {
                    BinaryOp::Add
                    | BinaryOp::Subtract
                    | BinaryOp::Multiply
                    | BinaryOp::Divide
                    | BinaryOp::Greater
                    | BinaryOp::GreaterEqual
                    | BinaryOp::Less
                    | BinaryOp::LessEqual => {
                        if left_type != Type::Unknown
                            && right_type != Type::Unknown
                            && (left_type != Type::Number || right_type != Type::Number)
                        {
                            self.error(
                                expr,
                                format!(
                                    "operator requires number operands, got {} and {}",
                                    left_type.name(),
                                    right_type.name()
                                ),
                                "Use numbers with arithmetic and ordered comparison operators.",
                            );
                        }
                        match operator {
                            BinaryOp::Greater
                            | BinaryOp::GreaterEqual
                            | BinaryOp::Less
                            | BinaryOp::LessEqual => Type::Bool,
                            _ => Type::Number,
                        }
                    }
                    BinaryOp::Equal | BinaryOp::NotEqual | BinaryOp::And | BinaryOp::Or => {
                        Type::Bool
                    }
                    BinaryOp::Join => Type::Text,
                }
            }
            ExprKind::Call { name, args } => {
                for argument in args {
                    self.check_expr(argument, values, in_function);
                }
                if let Some(function) = self.functions.get(name) {
                    if args.len() != function.arity {
                        self.error(
                            expr,
                            format!(
                                "function '{}' expects {} arguments but received {}",
                                name,
                                function.arity,
                                args.len()
                            ),
                            "Pass exactly the parameters declared by the function.",
                        );
                    }
                } else if !is_builtin(name) {
                    self.error(
                        expr,
                        format!("call to unknown function '{}'", name),
                        "Declare the function before calling it, or use a supported builtin.",
                    );
                }
                Type::Unknown
            }
        }
    }
}

fn merge_types(left: Type, right: Type) -> Type {
    if left == right { left } else { Type::Unknown }
}

fn is_builtin(name: &str) -> bool {
    matches!(
        name,
        "json_parse"
            | "json_stringify"
            | "http_get"
            | "http_post"
            | "read_file"
            | "write_file"
            | "env"
    )
}

#[cfg(test)]
mod tests {
    use super::check;
    use crate::{lexer, parser::Parser};

    fn parse(source: &str) -> Vec<crate::ast::Stmt> {
        Parser::new(lexer::lex(source)).parse().unwrap()
    }

    #[test]
    fn reports_unknown_symbols_and_known_function_arity() {
        let diagnostics = check(&parse(
            "print(missing)\nfn add(a, b) { return a + b }\nprint(add(1))\n",
        ))
        .unwrap_err();
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].line, 1);
        assert!(
            diagnostics[0]
                .message
                .contains("unknown variable 'missing'")
        );
        assert_eq!(diagnostics[1].line, 3);
        assert!(
            diagnostics[1]
                .message
                .contains("expects 2 arguments but received 1")
        );
    }

    #[test]
    fn rejects_only_provable_type_misuse() {
        let diagnostics = check(&parse(
            "let name = \"Ada\"\nprint(name[false])\nprint(\"x\" + 1)\n",
        ))
        .unwrap_err();
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].line, 2);
        assert!(
            diagnostics[0]
                .message
                .contains("index access requires an array or object")
        );
        assert_eq!(diagnostics[1].line, 3);
        assert!(diagnostics[1].message.contains("requires number operands"));
    }

    #[test]
    fn reports_literal_array_indices_that_are_out_of_bounds() {
        let diagnostics = check(&parse("let owners = [\"Ari\"]\nprint(owners[2])\n")).unwrap_err();
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].line, 2);
        assert!(diagnostics[0].message.contains("out of bounds"));
    }

    #[test]
    fn permits_dynamic_input_and_runtime_dependent_function_globals() {
        let statements =
            parse("fn show() { print(input.customer) print(later) }\nlet later = \"ok\"\nshow()\n");
        assert!(check(&statements).is_ok());
    }
}
