//! Conservative, non-executing semantic checks for parsed SolveLang programs.
//!
//! The checker reports only facts that follow from the parsed source. Values that
//! can depend on runtime input, calls, or branches stay `Unknown` instead of
//! producing speculative diagnostics.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::ast::{BinaryOp, ExportedDeclaration, Expr, ExprKind, Stmt};
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
    checker.check_scoped_block(statements, &mut HashMap::new(), false, []);
    if checker.diagnostics.is_empty() {
        Ok(())
    } else {
        Err(checker.diagnostics)
    }
}

struct Checker {
    functions: HashMap<String, FunctionSymbol>,
    agents: HashMap<String, ()>,
    imported_bindings: HashSet<String>,
    named_import_bindings: HashSet<String>,
    namespace_imports: HashSet<String>,
    import_shadow_scopes: Vec<HashSet<String>>,
    diagnostics: Vec<Diagnostic>,
}

impl Checker {
    fn new(statements: &[Stmt]) -> Self {
        let mut functions = HashMap::new();
        let mut agents = HashMap::new();
        let mut imported_bindings = HashSet::new();
        let mut named_import_bindings = HashSet::new();
        let mut namespace_imports = HashSet::new();
        let mut diagnostics = Vec::new();

        for statement in statements {
            match statement {
                Stmt::ModuleImport { namespace, .. } => {
                    imported_bindings.insert(namespace.clone());
                    namespace_imports.insert(namespace.clone());
                }
                Stmt::NamedModuleImport { bindings, .. } => {
                    for binding in bindings {
                        imported_bindings.insert(binding.local.clone());
                        named_import_bindings.insert(binding.local.clone());
                    }
                }
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
                Stmt::Export {
                    declaration:
                        ExportedDeclaration::Function {
                            name,
                            params,
                            location,
                            ..
                        },
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
            imported_bindings,
            named_import_bindings,
            namespace_imports,
            import_shadow_scopes: Vec::new(),
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

    fn check_scoped_block(
        &mut self,
        statements: &[Stmt],
        values: &mut HashMap<String, Type>,
        in_function: bool,
        shadows: impl IntoIterator<Item = String>,
    ) {
        self.import_shadow_scopes
            .push(shadows.into_iter().collect());
        self.check_block(statements, values, in_function);
        self.import_shadow_scopes.pop();
    }

    fn import_is_shadowed(&self, name: &str) -> bool {
        self.import_shadow_scopes
            .iter()
            .rev()
            .any(|scope| scope.contains(name))
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
                    if in_function && self.imported_bindings.contains(name) {
                        self.import_shadow_scopes
                            .last_mut()
                            .expect("semantic block has a shadow scope")
                            .insert(name.clone());
                    }
                }
                Stmt::Assign {
                    name,
                    value,
                    location,
                } => {
                    if self.imported_bindings.contains(name) && !self.import_is_shadowed(name) {
                        self.diagnostics.push(Diagnostic::new(
                            location.line,
                            location.column,
                            format!("cannot assign to imported binding '{}'", name),
                            "Imported values and namespaces are read-only.",
                        ));
                    }
                    if !values.contains_key(name) && name != "input" {
                        self.diagnostics.push(Diagnostic::new(
                            location.line,
                            location.column,
                            format!("assignment to unknown variable '{}'", name),
                            "Declare it with 'let' before assigning a value.",
                        ));
                    }
                    let value_type = self.check_expr(value, values, in_function);
                    if values.contains_key(name)
                        && (!self.imported_bindings.contains(name) || self.import_is_shadowed(name))
                    {
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
                    self.check_scoped_block(then_branch, &mut then_values, in_function, []);
                    self.check_scoped_block(else_branch, &mut else_values, in_function, []);
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
                    self.check_scoped_block(body, &mut body_values, in_function, []);
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
                    self.check_scoped_block(body, &mut body_values, in_function, [name.clone()]);
                    for name in body_values.keys() {
                        values.entry(name.clone()).or_insert(Type::Unknown);
                    }
                }
                Stmt::Function { params, body, .. }
                | Stmt::Export {
                    declaration: ExportedDeclaration::Function { params, body, .. },
                    ..
                } => {
                    let mut function_values = values.clone();
                    for binding in &self.imported_bindings {
                        function_values
                            .entry(binding.clone())
                            .or_insert(Type::Unknown);
                    }
                    for param in params {
                        function_values.insert(param.clone(), Type::Unknown);
                    }
                    self.check_scoped_block(
                        body,
                        &mut function_values,
                        true,
                        params.iter().cloned(),
                    );
                }
                Stmt::Break { .. } | Stmt::Continue { .. } | Stmt::Agent { .. } => {}
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
                Stmt::ModuleImport { namespace, .. } => {
                    values.insert(namespace.clone(), Type::Unknown);
                    self.imported_bindings.insert(namespace.clone());
                    self.namespace_imports.insert(namespace.clone());
                }
                Stmt::NamedModuleImport { bindings, .. } => {
                    for binding in bindings {
                        values.insert(binding.local.clone(), Type::Unknown);
                        self.imported_bindings.insert(binding.local.clone());
                        self.named_import_bindings.insert(binding.local.clone());
                    }
                }
                Stmt::Export {
                    declaration: ExportedDeclaration::Let { name, value, .. },
                    ..
                } => {
                    let value_type = self.check_expr(value, values, in_function);
                    values.insert(name.clone(), value_type);
                }
                Stmt::LegacyInclude { .. } => {}
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
                } else if !is_builtin(name) && !self.named_import_bindings.contains(name) {
                    self.error(
                        expr,
                        format!("call to unknown function '{}'", name),
                        "Declare the function before calling it, or use a supported builtin.",
                    );
                }
                Type::Unknown
            }
            ExprKind::ModuleCall {
                namespace, args, ..
            } => {
                for argument in args {
                    self.check_expr(argument, values, in_function);
                }
                if !self.namespace_imports.contains(namespace) {
                    self.error(
                        expr,
                        format!("unknown module namespace '{}'", namespace),
                        "Import the namespace before calling one of its members.",
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
        "length"
            | "is_empty"
            | "contains"
            | "get"
            | "keys"
            | "values"
            | "entries"
            | "json_parse"
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

    #[test]
    fn accepts_valid_loop_control_statements() {
        let statements = parse("while true { break }\nfor item in [1] { continue }\n");
        assert!(check(&statements).is_ok());
    }

    #[test]
    fn recognizes_pure_collection_helpers() {
        assert!(check(&parse("print(is_empty([]))\n")).is_ok());
        assert!(check(&parse("print(keys({ beta: 2, alpha: 1 }))\n")).is_ok());
        assert!(check(&parse("print(values({ beta: 2, alpha: 1 }))\n")).is_ok());
        assert!(check(&parse("print(entries({ beta: 2, alpha: 1 }))\n")).is_ok());
    }

    #[test]
    fn checks_explicit_module_bindings_and_exported_declarations() {
        assert!(check(&parse(
            "import { value } from \"a.solve\"\nlet copy = value\nexport let answer = 1\nlet repeated = answer\nexport fn identity(item) { return item }\nprint(identity(copy))\n",
        ))
        .is_ok());

        let diagnostics = check(&parse(
            "export let value = 1 + true\nexport fn invalid() { return \"x\" + 1 }\n",
        ))
        .expect_err("exported declarations must receive ordinary semantic checks");
        assert_eq!(diagnostics.len(), 2);
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.message.contains("requires number operands"))
        );
    }

    #[test]
    fn rejects_assignments_to_read_only_imported_bindings() {
        let diagnostics = check(&parse(
            "import \"a.solve\" as module\nmodule = 1\nimport { value } from \"a.solve\"\nvalue = 2\n",
        ))
        .expect_err("imports are read-only bindings");
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().all(|diagnostic| {
            diagnostic
                .message
                .contains("cannot assign to imported binding")
        }));
    }

    #[test]
    fn imported_bindings_remain_read_only_in_nested_blocks_but_allow_lexical_shadows() {
        let diagnostics = check(&parse(
            "import { value } from \"a.solve\"\nfn invalid() { if true { value = 2 } }\n",
        ))
        .expect_err("nested assignment to an import must fail");
        assert!(diagnostics.iter().any(|diagnostic| {
            diagnostic
                .message
                .contains("cannot assign to imported binding 'value'")
        }));

        check(&parse(
            "import { value } from \"a.solve\"\nfn parameter(value) { value = 2 }\nfn local() { let value = 1 value = 2 }\nfn loop() { for value in [1] { value = 2 } }\n",
        ))
        .expect("parameter, local, and loop shadows are writable lexical bindings");
    }

    #[test]
    fn accepts_named_import_calls_and_requires_namespace_imports() {
        assert!(check(&parse("import { add } from \"math.solve\"\nadd(1, 2)\n")).is_ok());

        let diagnostics = check(&parse("import \"math.solve\" as math\nmath()\n"))
            .expect_err("namespace aliases are not direct call targets");
        assert!(
            diagnostics[0]
                .message
                .contains("call to unknown function 'math'")
        );

        let diagnostics =
            check(&parse("missing.add(1, 2)\n")).expect_err("missing namespace fails");
        assert!(
            diagnostics[0]
                .message
                .contains("unknown module namespace 'missing'")
        );
        assert!(check(&parse("unknown(1)\n")).is_err());
    }

    #[test]
    fn functions_can_reference_later_imported_bindings() {
        assert!(
            check(&parse(
                "fn wrapper() { return add(1, 2) }\nimport { add } from \"math.solve\"\n",
            ))
            .is_ok()
        );
        assert!(
            check(&parse(
                "fn wrapper() { return math.add(1, 2) }\nimport \"math.solve\" as math\n",
            ))
            .is_ok()
        );
    }
}
