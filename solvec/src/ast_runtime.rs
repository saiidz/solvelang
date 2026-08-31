use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use reqwest::blocking::Client;
use serde_json::Value as JsonValue;

use crate::ai;
use crate::ast::{BinaryOp, Expr, ExprKind, SourceLocation, Stmt, UnaryOp};
use crate::module_resolver::{ExportKind, ModuleGraph};
use crate::value::Value;

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeError {
    message: String,
    context: Option<Box<RuntimeErrorContext>>,
}

#[derive(Clone, Debug, PartialEq)]
struct RuntimeErrorContext {
    location: SourceLocation,
    source_line: Option<String>,
    filename: Option<String>,
    hint: Option<String>,
}

impl RuntimeError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            context: None,
        }
    }

    fn at(
        message: impl Into<String>,
        location: SourceLocation,
        source_line: Option<String>,
        filename: Option<String>,
        hint: Option<String>,
    ) -> Self {
        Self {
            message: message.into(),
            context: Some(Box::new(RuntimeErrorContext {
                location,
                source_line,
                filename,
                hint,
            })),
        }
    }

    fn with_context(
        mut self,
        location: SourceLocation,
        source_line: Option<String>,
        filename: Option<String>,
    ) -> Self {
        if self.context.is_none() {
            self.context = Some(Box::new(RuntimeErrorContext {
                location,
                source_line,
                filename,
                hint: None,
            }));
        }
        self
    }
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(context) = &self.context {
            let location = context.location;
            write!(
                formatter,
                "SolveLang Runtime Error on line {}, column {}",
                location.line, location.column
            )?;
            if let Some(filename) = &context.filename {
                write!(formatter, " in {}", filename)?;
            }
            if let Some(source_line) = &context.source_line {
                let padding = " ".repeat(location.column.saturating_sub(1));
                write!(
                    formatter,
                    "\n{:>3} | {}\n    | {}^\n{}",
                    location.line, source_line, padding, self.message
                )?;
            } else {
                write!(formatter, "\n{}", self.message)?;
            }
            if let Some(hint) = &context.hint {
                write!(formatter, "\nHint: {}", hint)?;
            }
            Ok(())
        } else {
            write!(formatter, "SolveLang Runtime Error: {}", self.message)
        }
    }
}

#[derive(Clone, Debug)]
struct Function {
    name: String,
    params: Vec<String>,
    body: Vec<Stmt>,
    module_identity: Option<String>,
}

#[derive(Clone, Debug)]
struct ImportedValue {
    module_identity: String,
    exported_name: String,
}

#[derive(Clone, Debug)]
struct ModuleScope {
    vars: HashMap<String, Value>,
    functions: HashMap<String, Function>,
    imported_values: HashMap<String, ImportedValue>,
    namespaces: HashMap<String, String>,
    read_only_bindings: HashSet<String>,
    exports: BTreeMap<String, ExportKind>,
    source_lines: Vec<String>,
    filename: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ModuleInitializationStatus {
    Initializing,
    Initialized,
}

#[derive(Clone, Debug)]
struct Agent {
    instruction: String,
    tools: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
enum ControlFlow {
    None,
    Return(Value),
    Break,
    Continue,
}

#[derive(Clone, Debug)]
pub struct ExecutionPolicy {
    pub allow_network: bool,
    pub allow_file_read: bool,
    pub allow_file_write: bool,
    pub allow_env: bool,
    pub allowed_roots: Vec<PathBuf>,
    pub restrict_filesystem_roots: bool,
    pub http_connect_timeout: Duration,
    pub http_request_timeout: Duration,
    pub http_max_body_bytes: usize,
}

impl ExecutionPolicy {
    pub const DEFAULT_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
    pub const DEFAULT_HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
    pub const DEFAULT_HTTP_MAX_BODY_BYTES: usize = 1_048_576;

    pub fn unrestricted() -> Self {
        Self {
            allow_network: true,
            allow_file_read: true,
            allow_file_write: true,
            allow_env: true,
            allowed_roots: Vec::new(),
            restrict_filesystem_roots: false,
            http_connect_timeout: Self::DEFAULT_HTTP_CONNECT_TIMEOUT,
            http_request_timeout: Self::DEFAULT_HTTP_REQUEST_TIMEOUT,
            http_max_body_bytes: Self::DEFAULT_HTTP_MAX_BODY_BYTES,
        }
    }

    pub fn safe(allowed_roots: Vec<PathBuf>) -> Self {
        Self {
            allow_network: false,
            allow_file_read: false,
            allow_file_write: false,
            allow_env: false,
            allowed_roots,
            restrict_filesystem_roots: true,
            http_connect_timeout: Self::DEFAULT_HTTP_CONNECT_TIMEOUT,
            http_request_timeout: Self::DEFAULT_HTTP_REQUEST_TIMEOUT,
            http_max_body_bytes: Self::DEFAULT_HTTP_MAX_BODY_BYTES,
        }
    }
}

pub struct AstRuntime {
    vars: HashMap<String, Value>,
    functions: HashMap<String, Function>,
    agents: HashMap<String, Agent>,
    policy: ExecutionPolicy,
    source_lines: Vec<String>,
    filename: Option<String>,
    capture_output: bool,
    outputs: Vec<Value>,
    input_injected: bool,
    imported_values: HashMap<String, ImportedValue>,
    namespaces: HashMap<String, String>,
    read_only_bindings: HashSet<String>,
    module_scopes: HashMap<String, ModuleScope>,
    module_initialization: HashMap<String, ModuleInitializationStatus>,
    local_bindings: Vec<HashMap<String, Value>>,
    function_scope_starts: Vec<usize>,
    active_module_calls: Vec<String>,
    active_module: Option<String>,
    module_execution_enabled: bool,
}

impl Default for AstRuntime {
    fn default() -> Self {
        Self {
            vars: HashMap::new(),
            functions: HashMap::new(),
            agents: HashMap::new(),
            policy: ExecutionPolicy::unrestricted(),
            source_lines: Vec::new(),
            filename: None,
            capture_output: false,
            outputs: Vec::new(),
            input_injected: false,
            imported_values: HashMap::new(),
            namespaces: HashMap::new(),
            read_only_bindings: HashSet::new(),
            module_scopes: HashMap::new(),
            module_initialization: HashMap::new(),
            local_bindings: Vec::new(),
            function_scope_starts: Vec::new(),
            active_module_calls: Vec::new(),
            active_module: None,
            module_execution_enabled: false,
        }
    }
}

impl AstRuntime {
    pub fn with_input(
        policy: ExecutionPolicy,
        source: &str,
        filename: &str,
        input: Option<Value>,
        capture_output: bool,
    ) -> Self {
        let mut vars = HashMap::new();
        let input_injected = input.is_some();
        if let Some(input) = input {
            vars.insert("input".to_string(), input);
        }

        Self {
            vars,
            source_lines: source.lines().map(str::to_owned).collect(),
            filename: Some(filename.to_string()),
            policy,
            capture_output,
            input_injected,
            ..Self::default()
        }
    }

    pub fn outputs(&self) -> &[Value] {
        &self.outputs
    }

    fn emit(&mut self, value: Value) {
        if self.capture_output {
            self.outputs.push(value);
        } else {
            println!("{}", value);
        }
    }

    fn error_at(
        &self,
        location: SourceLocation,
        message: impl Into<String>,
        hint: Option<String>,
    ) -> RuntimeError {
        RuntimeError::at(
            message,
            location,
            self.source_lines
                .get(location.line.saturating_sub(1))
                .cloned(),
            self.filename.clone(),
            hint,
        )
    }

    fn attach_location(&self, error: RuntimeError, location: SourceLocation) -> RuntimeError {
        error.with_context(
            location,
            self.source_lines
                .get(location.line.saturating_sub(1))
                .cloned(),
            self.filename.clone(),
        )
    }

    pub fn run(&mut self, statements: &[Stmt]) -> Result<(), RuntimeError> {
        if let Some(location) = first_explicit_module_location(statements) {
            return Err(self.error_at(
                location,
                "explicit local modules are not executable until module resolution is available",
                Some(
                    "Use the legacy import form until the resolver implementation is released."
                        .to_string(),
                ),
            ));
        }
        self.execute_block(statements).map(|_| ())
    }

    pub fn run_with_modules(
        &mut self,
        graph: &ModuleGraph,
        statements: &[Stmt],
    ) -> Result<(), RuntimeError> {
        let entry_identity = graph
            .order
            .last()
            .ok_or_else(|| RuntimeError::new("explicit module graph is empty"))?
            .clone();

        for binding in &self.read_only_bindings {
            self.functions.remove(binding);
        }
        self.imported_values.clear();
        self.namespaces.clear();
        self.read_only_bindings.clear();
        self.module_scopes.clear();
        self.module_initialization.clear();
        let saved_module_scopes = self.module_scopes.clone();
        let saved_initialization = self.module_initialization.clone();
        for identity in &graph.order {
            if identity == &entry_identity {
                continue;
            }
            if let Err(error) = self.initialize_module(graph, identity) {
                self.module_scopes = saved_module_scopes;
                self.module_initialization = saved_initialization;
                return Err(error);
            }
        }

        let entry = graph
            .modules
            .get(&entry_identity)
            .ok_or_else(|| RuntimeError::new("explicit module entry is missing from the graph"))?;
        self.module_execution_enabled = true;
        self.install_imports(statements, entry.dependencies.as_slice())?;
        self.execute_block(statements).map(|_| ())
    }

    fn initialize_module(
        &mut self,
        graph: &ModuleGraph,
        identity: &str,
    ) -> Result<(), RuntimeError> {
        match self.module_initialization.get(identity) {
            Some(ModuleInitializationStatus::Initialized) => return Ok(()),
            Some(ModuleInitializationStatus::Initializing) => {
                return Err(RuntimeError::new(format!(
                    "recursive initialization of module '{}' was rejected",
                    identity
                )));
            }
            None => {}
        }
        let node = graph
            .modules
            .get(identity)
            .ok_or_else(|| RuntimeError::new("resolved module is missing from the graph"))?;
        self.module_initialization.insert(
            identity.to_string(),
            ModuleInitializationStatus::Initializing,
        );
        let source = node.source.clone();
        let statements = node.statements.clone();
        let mut module =
            AstRuntime::with_input(self.policy.clone(), &source, identity, None, false);
        module.module_scopes = self.module_scopes.clone();
        module.active_module = Some(identity.to_string());
        module.module_execution_enabled = true;
        if let Err(error) = module
            .install_imports(&statements, node.dependencies.as_slice())
            .and_then(|_| module.execute_module_declarations(&statements))
        {
            self.module_initialization.remove(identity);
            return Err(error);
        }
        self.module_scopes.insert(
            identity.to_string(),
            ModuleScope {
                vars: module.vars,
                functions: module.functions,
                imported_values: module.imported_values,
                namespaces: module.namespaces,
                read_only_bindings: module.read_only_bindings,
                exports: node.exports.clone(),
                source_lines: module.source_lines,
                filename: identity.to_string(),
            },
        );
        self.module_initialization.insert(
            identity.to_string(),
            ModuleInitializationStatus::Initialized,
        );
        Ok(())
    }

    fn install_imports(
        &mut self,
        statements: &[Stmt],
        dependencies: &[String],
    ) -> Result<(), RuntimeError> {
        let mut dependencies = dependencies.iter();
        for statement in statements {
            let (bindings, location) = match statement {
                Stmt::ModuleImport {
                    namespace,
                    location,
                    ..
                } => (
                    vec![(None, namespace.clone(), namespace.clone())],
                    *location,
                ),
                Stmt::NamedModuleImport {
                    bindings, location, ..
                } => (
                    bindings
                        .iter()
                        .map(|binding| {
                            (
                                Some(binding.exported.clone()),
                                binding.local.clone(),
                                binding.local.clone(),
                            )
                        })
                        .collect(),
                    *location,
                ),
                _ => continue,
            };
            let dependency = dependencies.next().ok_or_else(|| {
                self.error_at(
                    location,
                    "explicit module import is absent from the validated dependency graph",
                    None,
                )
            })?;
            let scope = self.module_scopes.get(dependency).ok_or_else(|| {
                self.error_at(
                    location,
                    "explicit module dependency was not initialized",
                    None,
                )
            })?;
            for (exported, local, namespace) in bindings {
                self.read_only_bindings.insert(local.clone());
                match exported {
                    None => {
                        self.namespaces.insert(namespace, dependency.clone());
                    }
                    Some(exported) => match scope.exports.get(&exported) {
                        Some(ExportKind::Let) => {
                            self.imported_values.insert(
                                local,
                                ImportedValue {
                                    module_identity: dependency.clone(),
                                    exported_name: exported,
                                },
                            );
                        }
                        Some(ExportKind::Function) => {
                            let function =
                                scope.functions.get(&exported).cloned().ok_or_else(|| {
                                    self.error_at(
                                        location,
                                        "validated exported function was not initialized",
                                        None,
                                    )
                                })?;
                            self.functions.insert(local, function);
                        }
                        None => {
                            return Err(self.error_at(
                                location,
                                "validated module import is missing its export",
                                None,
                            ));
                        }
                    },
                }
            }
        }
        if dependencies.next().is_some() {
            return Err(RuntimeError::new(
                "validated module graph contains an unbound explicit import",
            ));
        }
        Ok(())
    }

    fn execute_module_declarations(&mut self, statements: &[Stmt]) -> Result<(), RuntimeError> {
        for statement in statements {
            match statement {
                Stmt::ModuleImport { .. } | Stmt::NamedModuleImport { .. } => {}
                Stmt::Let { value, .. } => {
                    self.require_pure_module_initializer(value)?;
                    self.execute(statement)?;
                }
                Stmt::Function { .. } => {
                    self.execute(statement)?;
                }
                Stmt::Export { declaration, .. } => match declaration {
                    crate::ast::ExportedDeclaration::Let {
                        name,
                        value,
                        location,
                    } => {
                        self.require_pure_module_initializer(value)?;
                        self.execute(&Stmt::Let {
                            name: name.clone(),
                            value: value.clone(),
                            location: *location,
                        })?;
                    }
                    crate::ast::ExportedDeclaration::Function {
                        name,
                        params,
                        body,
                        location,
                    } => {
                        self.execute(&Stmt::Function {
                            name: name.clone(),
                            params: params.clone(),
                            body: body.clone(),
                            location: *location,
                        })?;
                    }
                },
                _ => {
                    return Err(self.error_at(
                        statement_location(statement),
                        "module top level may contain only imports, let declarations, and fn declarations",
                        Some("Keep module setup declarative; executable statements belong in exported functions.".to_string()),
                    ));
                }
            }
        }
        Ok(())
    }

    fn require_pure_module_initializer(&self, expression: &Expr) -> Result<(), RuntimeError> {
        if let Some(location) = first_call_location(expression) {
            return Err(self.error_at(
                location,
                "module top-level initializers may not call functions",
                Some("Use literals, data construction, and operators at module top level; call functions explicitly after initialization.".to_string()),
            ));
        }
        Ok(())
    }

    fn executing_function(&self) -> bool {
        !self.local_bindings.is_empty()
    }

    fn local_value(&self, name: &str) -> Option<Value> {
        let start = self.function_scope_starts.last().copied().unwrap_or(0);
        self.local_bindings
            .get(start..)
            .unwrap_or_default()
            .iter()
            .rev()
            .find_map(|scope| scope.get(name).cloned())
    }

    fn local_binding_scope(&self, name: &str) -> Option<usize> {
        let start = self.function_scope_starts.last().copied().unwrap_or(0);
        (start..self.local_bindings.len())
            .rev()
            .find(|index| self.local_bindings[*index].contains_key(name))
    }

    fn execute_module_scoped_block(
        &mut self,
        statements: &[Stmt],
    ) -> Result<ControlFlow, RuntimeError> {
        if !self.executing_function() {
            return self.execute_block(statements);
        }

        self.local_bindings.push(HashMap::new());
        let flow = self.execute_block(statements);
        self.local_bindings.pop();
        flow
    }

    fn execute_block(&mut self, statements: &[Stmt]) -> Result<ControlFlow, RuntimeError> {
        for statement in statements {
            let flow = self.execute(statement)?;
            if flow != ControlFlow::None {
                return Ok(flow);
            }
        }

        Ok(ControlFlow::None)
    }

    fn execute(&mut self, statement: &Stmt) -> Result<ControlFlow, RuntimeError> {
        match statement {
            Stmt::LegacyInclude { location, .. } => Err(self.error_at(
                *location,
                "legacy imports must be expanded before evaluation",
                Some("Run source through the compatibility import loader.".to_string()),
            )),
            Stmt::ModuleImport { location, .. } | Stmt::NamedModuleImport { location, .. } => {
                if self.module_execution_enabled {
                    Ok(ControlFlow::None)
                } else {
                    Err(self.error_at(
                        *location,
                        "explicit local modules are not executable until module resolution is available",
                        Some(
                            "Use the legacy import form until the resolver implementation is released."
                                .to_string(),
                        ),
                    ))
                }
            }
            Stmt::Export {
                declaration,
                location,
            } => {
                if !self.module_execution_enabled {
                    return Err(self.error_at(
                        *location,
                        "explicit local modules are not executable until module resolution is available",
                        Some(
                            "Use the legacy import form until the resolver implementation is released."
                                .to_string(),
                        ),
                    ));
                }
                match declaration {
                    crate::ast::ExportedDeclaration::Let {
                        name,
                        value,
                        location,
                    } => self.execute(&Stmt::Let {
                        name: name.clone(),
                        value: value.clone(),
                        location: *location,
                    }),
                    crate::ast::ExportedDeclaration::Function {
                        name,
                        params,
                        body,
                        location,
                    } => self.execute(&Stmt::Function {
                        name: name.clone(),
                        params: params.clone(),
                        body: body.clone(),
                        location: *location,
                    }),
                }
            }
            Stmt::Let {
                name,
                value,
                location,
            } => {
                if self.read_only_bindings.contains(name) && !self.executing_function() {
                    return Err(self.error_at(
                        *location,
                        format!("imported binding '{}' is read-only", name),
                        None,
                    ));
                }
                if self.input_injected && name == "input" {
                    return Err(self.error_at(
                        *location,
                        "the injected input value is read-only",
                        None,
                    ));
                }
                let value = self.eval(value)?;
                if self.executing_function() {
                    self.local_bindings
                        .last_mut()
                        .expect("module function has a local binding scope")
                        .insert(name.clone(), value);
                    return Ok(ControlFlow::None);
                }
                self.vars.insert(name.clone(), value);
                Ok(ControlFlow::None)
            }
            Stmt::Assign {
                name,
                value,
                location,
            } => {
                if self.read_only_bindings.contains(name)
                    && self.local_binding_scope(name).is_none()
                {
                    return Err(self.error_at(
                        *location,
                        format!("imported binding '{}' is read-only", name),
                        None,
                    ));
                }
                if self.input_injected && name == "input" {
                    return Err(self.error_at(
                        *location,
                        "the injected input value is read-only",
                        None,
                    ));
                }
                if let Some(index) = self.local_binding_scope(name) {
                    let value = self.eval(value)?;
                    self.local_bindings[index].insert(name.clone(), value);
                    return Ok(ControlFlow::None);
                }
                if !self.vars.contains_key(name) {
                    return Err(self.error_at(
                        *location,
                        format!("unknown variable '{}'", name),
                        None,
                    ));
                }
                let value = self.eval(value)?;
                self.vars.insert(name.clone(), value);
                Ok(ControlFlow::None)
            }
            Stmt::Print { value, .. } => {
                let value = self.eval(value)?;
                self.emit(value);
                Ok(ControlFlow::None)
            }
            Stmt::Return { value, .. } => Ok(ControlFlow::Return(self.eval(value)?)),
            Stmt::Function {
                name, params, body, ..
            } => {
                if self.input_injected && (name == "input" || params.iter().any(|p| p == "input")) {
                    return Err(RuntimeError::new(
                        "the injected input value cannot be shadowed by a function",
                    ));
                }
                self.functions.insert(
                    name.clone(),
                    Function {
                        name: name.clone(),
                        params: params.clone(),
                        body: body.clone(),
                        module_identity: self.active_module.clone(),
                    },
                );
                Ok(ControlFlow::None)
            }
            Stmt::If {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                if self.eval(condition)?.is_truthy() {
                    self.execute_module_scoped_block(then_branch)
                } else {
                    self.execute_module_scoped_block(else_branch)
                }
            }
            Stmt::While {
                condition,
                body,
                location,
            } => {
                let mut safety_counter = 0;

                while self.eval(condition)?.is_truthy() {
                    if safety_counter >= 10_000 {
                        return Err(self.error_at(
                            *location,
                            "loop stopped after 10000 iterations",
                            Some(
                                "Review the loop condition or add a terminating update."
                                    .to_string(),
                            ),
                        ));
                    }
                    safety_counter += 1;
                    match self.execute_module_scoped_block(body)? {
                        ControlFlow::None | ControlFlow::Continue => {}
                        ControlFlow::Break => return Ok(ControlFlow::None),
                        flow @ ControlFlow::Return(_) => return Ok(flow),
                    }
                }

                Ok(ControlFlow::None)
            }
            Stmt::For {
                name,
                iterable,
                body,
                location,
            } => {
                let values = match self.eval(iterable)? {
                    Value::Array(values) => values,
                    _ => {
                        return Err(self.error_at(
                            iterable.location,
                            "for loops require an array iterable",
                            Some(
                                "Use an array value after 'in', such as: for item in items { ... }"
                                    .to_string(),
                            ),
                        ));
                    }
                };
                if values.len() > 10_000 {
                    return Err(self.error_at(
                        *location,
                        "loop stopped after 10000 iterations",
                        Some("Iterate over an array with at most 10000 items.".to_string()),
                    ));
                }
                for value in values {
                    let mut loop_scope = HashMap::new();
                    loop_scope.insert(name.clone(), value);
                    self.local_bindings.push(loop_scope);
                    let flow = self.execute_module_scoped_block(body);
                    self.local_bindings.pop();
                    match flow? {
                        ControlFlow::None | ControlFlow::Continue => {}
                        ControlFlow::Break => return Ok(ControlFlow::None),
                        flow @ ControlFlow::Return(_) => return Ok(flow),
                    }
                }
                Ok(ControlFlow::None)
            }
            Stmt::Break { .. } => Ok(ControlFlow::Break),
            Stmt::Continue { .. } => Ok(ControlFlow::Continue),
            Stmt::Agent {
                name,
                instruction,
                tools,
                ..
            } => {
                self.agents.insert(
                    name.clone(),
                    Agent {
                        instruction: instruction.clone(),
                        tools: tools.clone(),
                    },
                );
                Ok(ControlFlow::None)
            }
            Stmt::Ask {
                agent,
                message,
                location,
            } => {
                let message_value = self.eval(message)?;
                let response = self.ask_agent(agent, &message_value, *location)?;
                self.emit(Value::Text(response));
                Ok(ControlFlow::None)
            }
            Stmt::Expr(expr) => {
                self.eval(expr)?;
                Ok(ControlFlow::None)
            }
        }
    }

    fn eval(&mut self, expr: &Expr) -> Result<Value, RuntimeError> {
        match &expr.kind {
            ExprKind::Number(value) => Ok(Value::Number(*value)),
            ExprKind::Text(value) => Ok(Value::Text(value.clone())),
            ExprKind::Bool(value) => Ok(Value::Bool(*value)),
            ExprKind::Variable(name) => {
                if let Some(value) = self.local_value(name) {
                    return Ok(value);
                }
                if let Some(imported) = self.imported_values.get(name).cloned() {
                    return self.imported_value(&imported, expr.location);
                }
                if let Some(identity) = self.namespaces.get(name).cloned() {
                    return self.namespace_value(&identity, expr.location);
                }
                self.vars.get(name).cloned().ok_or_else(|| {
                    self.error_at(expr.location, format!("unknown variable '{}'", name), None)
                })
            }
            ExprKind::Array(values) => {
                let mut result = Vec::new();
                for value in values {
                    result.push(self.eval(value)?);
                }
                Ok(Value::Array(result))
            }
            ExprKind::Object(entries) => {
                let mut result = BTreeMap::new();
                for (key, value_expr) in entries {
                    result.insert(key.clone(), self.eval(value_expr)?);
                }
                Ok(Value::Object(result))
            }
            ExprKind::Property(target, property) => {
                if let ExprKind::Variable(namespace) = &target.kind
                    && self.local_value(namespace).is_none()
                    && let Some(identity) = self.namespaces.get(namespace).cloned()
                {
                    return self.namespace_export_value(&identity, property, expr.location);
                }
                let target = self.eval(target)?;
                match target {
                    Value::Object(entries) => {
                        Ok(entries.get(property).cloned().unwrap_or(Value::Null))
                    }
                    value => Err(self.error_at(
                        expr.location,
                        format!(
                            "Property access requires an object, got {}.",
                            value.type_name()
                        ),
                        Some("Use property access only with an object value.".to_string()),
                    )),
                }
            }
            ExprKind::Index(target, index) => {
                let target = self.eval(target)?;
                let index_value = self.eval(index)?;

                match target {
                    Value::Array(values) => match index_value {
                        Value::Number(index_number) if index_number < 0 => Err(self.error_at(
                            index.location,
                            "Array index cannot be negative.",
                            Some("Use an index starting at 0.".to_string()),
                        )),
                        Value::Number(index_number) => values.get(index_number as usize).cloned().ok_or_else(|| {
                            self.error_at(
                                index.location,
                                format!("Array index {} is out of bounds for an array of length {}.", index_number, values.len()),
                                Some(if values.is_empty() { "The array is empty, so no index is valid.".to_string() } else { format!("Use an index between 0 and {}.", values.len() - 1) }),
                            )
                        }),
                        value => Err(self.error_at(
                            index.location,
                            format!("Array index must be a number, got {}.", value.type_name()),
                            Some("Use a numeric array index.".to_string()),
                        )),
                    },
                    Value::Object(entries) => match index_value {
                        Value::Text(key) => Ok(entries.get(&key).cloned().unwrap_or(Value::Null)),
                        value => Err(self.error_at(
                            index.location,
                            format!("Object index must be text, got {}.", value.type_name()),
                            Some("Use a quoted object key.".to_string()),
                        )),
                    },
                    value => Err(self.error_at(
                        expr.location,
                        format!("Index access requires an array or object, got {}.", value.type_name()),
                        Some("Use [index] with an array or object value.".to_string()),
                    )),
                }
            }
            ExprKind::Unary { operator, expr } => {
                let value = self.eval(expr)?;
                Ok(self.eval_unary(operator, value))
            }
            ExprKind::Binary {
                left,
                operator,
                right,
            } => {
                let left = self.eval(left)?;
                let right = self.eval(right)?;
                self.eval_binary(left, operator, right, expr.location)
            }
            ExprKind::Call { name, args } => self.call_function(name, args, expr.location),
            ExprKind::ModuleCall {
                namespace,
                member,
                args,
            } => self.call_module_function(namespace, member, args, expr.location),
        }
    }

    fn eval_unary(&self, operator: &UnaryOp, value: Value) -> Value {
        match operator {
            UnaryOp::Not => Value::Bool(!value.is_truthy()),
        }
    }

    fn eval_binary(
        &self,
        left: Value,
        operator: &BinaryOp,
        right: Value,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        match operator {
            BinaryOp::Add => {
                self.checked_numeric_binary(left, right, location, "+", i32::checked_add)
            }
            BinaryOp::Subtract => {
                self.checked_numeric_binary(left, right, location, "-", i32::checked_sub)
            }
            BinaryOp::Multiply => {
                self.checked_numeric_binary(left, right, location, "*", i32::checked_mul)
            }
            BinaryOp::Divide => {
                let (left_number, right_number) =
                    self.numeric_operands(left, right, location, "/")?;
                if right_number == 0 {
                    Err(self.error_at(
                        location,
                        "divide by zero",
                        Some("Use a non-zero divisor.".to_string()),
                    ))
                } else {
                    left_number
                        .checked_div(right_number)
                        .map(Value::Number)
                        .ok_or_else(|| self.integer_overflow_error(location, "/"))
                }
            }
            BinaryOp::Join => Ok(Value::Text(format!("{}{}", left, right))),
            BinaryOp::And => Ok(Value::Bool(left.is_truthy() && right.is_truthy())),
            BinaryOp::Or => Ok(Value::Bool(left.is_truthy() || right.is_truthy())),
            BinaryOp::Equal => Ok(Value::Bool(left == right)),
            BinaryOp::NotEqual => Ok(Value::Bool(left != right)),
            BinaryOp::Greater => self.numeric_comparison(left, right, location, ">", |a, b| a > b),
            BinaryOp::GreaterEqual => {
                self.numeric_comparison(left, right, location, ">=", |a, b| a >= b)
            }
            BinaryOp::Less => self.numeric_comparison(left, right, location, "<", |a, b| a < b),
            BinaryOp::LessEqual => {
                self.numeric_comparison(left, right, location, "<=", |a, b| a <= b)
            }
        }
    }

    fn checked_numeric_binary(
        &self,
        left: Value,
        right: Value,
        location: SourceLocation,
        operator: &str,
        operation: impl FnOnce(i32, i32) -> Option<i32>,
    ) -> Result<Value, RuntimeError> {
        let (left, right) = self.numeric_operands(left, right, location, operator)?;
        operation(left, right)
            .map(Value::Number)
            .ok_or_else(|| self.integer_overflow_error(location, operator))
    }

    fn integer_overflow_error(&self, location: SourceLocation, operator: &str) -> RuntimeError {
        self.error_at(
            location,
            format!("integer overflow for operator '{}'", operator),
            Some("Keep arithmetic results within the signed 32-bit integer range.".to_string()),
        )
    }

    fn numeric_comparison(
        &self,
        left: Value,
        right: Value,
        location: SourceLocation,
        operator: &str,
        comparison: impl FnOnce(i32, i32) -> bool,
    ) -> Result<Value, RuntimeError> {
        let (left, right) = self.numeric_operands(left, right, location, operator)?;
        Ok(Value::Bool(comparison(left, right)))
    }

    fn numeric_operands(
        &self,
        left: Value,
        right: Value,
        location: SourceLocation,
        operator: &str,
    ) -> Result<(i32, i32), RuntimeError> {
        match (&left, &right) {
            (Value::Number(left), Value::Number(right)) => Ok((*left, *right)),
            _ => Err(self.error_at(
                location,
                format!(
                    "operator '{}' requires number operands, got {} and {}",
                    operator,
                    left.type_name(),
                    right.type_name()
                ),
                Some("Use numbers with arithmetic and ordered comparison operators.".to_string()),
            )),
        }
    }

    fn call_function(
        &mut self,
        name: &str,
        args: &[Expr],
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        if self.read_only_bindings.contains(name) && self.local_value(name).is_some() {
            return Err(self.error_at(
                location,
                format!("lexical binding '{}' is not callable", name),
                None,
            ));
        }
        if let Some(value) = self.call_builtin(name, args, location) {
            return value.map_err(|error| self.attach_location(error, location));
        }

        let function = match self.functions.get(name) {
            Some(function) => function.clone(),
            None => {
                return Err(self.error_at(location, format!("unknown function '{}'", name), None));
            }
        };

        let values = args
            .iter()
            .map(|argument| self.eval(argument))
            .collect::<Result<Vec<_>, _>>()?;
        self.invoke_function(function, values, location)
    }

    fn call_module_function(
        &mut self,
        namespace: &str,
        member: &str,
        args: &[Expr],
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        if self.local_value(namespace).is_some() {
            return Err(self.error_at(
                location,
                format!("lexical binding '{}' is not a module namespace", namespace),
                None,
            ));
        }
        let identity = self.namespaces.get(namespace).cloned().ok_or_else(|| {
            self.error_at(
                location,
                format!("unknown module namespace '{}'", namespace),
                None,
            )
        })?;
        let scope = self
            .module_scopes
            .get(&identity)
            .ok_or_else(|| self.error_at(location, "module namespace was not initialized", None))?;
        if scope.exports.get(member) != Some(&ExportKind::Function) {
            return Err(self.error_at(
                location,
                format!(
                    "module '{}' does not export function '{}'",
                    identity, member
                ),
                None,
            ));
        }
        let function = scope.functions.get(member).cloned().ok_or_else(|| {
            self.error_at(
                location,
                "validated exported function was not initialized",
                None,
            )
        })?;
        let values = args
            .iter()
            .map(|argument| self.eval(argument))
            .collect::<Result<Vec<_>, _>>()?;
        self.invoke_function(function, values, location)
    }

    fn invoke_function(
        &mut self,
        function: Function,
        values: Vec<Value>,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        if values.len() != function.params.len() {
            return Err(self.error_at(
                location,
                format!(
                    "Function '{}' expects {} arguments but received {}.",
                    function.name,
                    function.params.len(),
                    values.len()
                ),
                Some("Pass exactly the parameters declared by the function.".to_string()),
            ));
        }

        let saved = self.capture_scope();
        let module_identity = function.module_identity.clone();
        let same_module_call = module_identity
            .as_ref()
            .is_some_and(|identity| self.active_module_calls.last() == Some(identity));
        let saved_local_bindings = if module_identity.is_some() {
            Some(std::mem::take(&mut self.local_bindings))
        } else {
            None
        };

        if let Some(identity) = &module_identity {
            if !same_module_call {
                let scope = self.module_scopes.get(identity).cloned().ok_or_else(|| {
                    self.error_at(
                        location,
                        "function's defining module was not initialized",
                        None,
                    )
                })?;
                self.apply_scope(scope);
            }
            self.active_module_calls.push(identity.clone());
            self.function_scope_starts.push(self.local_bindings.len());
            let params = function
                .params
                .iter()
                .zip(values.iter())
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect();
            self.local_bindings.push(params);
        } else {
            self.function_scope_starts.push(self.local_bindings.len());
            let params = function
                .params
                .iter()
                .zip(values.iter())
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect();
            self.local_bindings.push(params);
        }

        let flow = self.execute_block(&function.body);
        if module_identity.is_some() {
            self.local_bindings.pop();
            self.function_scope_starts.pop();
            self.active_module_calls.pop();
        } else {
            self.local_bindings.pop();
            self.function_scope_starts.pop();
        }

        // A module call is the transaction boundary. A successful cross-module call
        // commits its defining module before the caller resumes; a later caller
        // failure rolls back only the caller, not the already committed callee.
        if let (Some(identity), Ok(_)) = (&module_identity, &flow)
            && !same_module_call
        {
            let updated_vars = self.vars.clone();
            let scope = self
                .module_scopes
                .get_mut(identity)
                .expect("module scope remains initialized during its function call");
            scope.vars = updated_vars;
        }

        match (module_identity.is_some(), same_module_call, flow.is_ok()) {
            (true, true, true) => self.restore_scope_preserving_vars(saved),
            _ => self.restore_scope(saved),
        }
        if let Some(local_bindings) = saved_local_bindings {
            self.local_bindings = local_bindings;
        }
        let flow = flow?;
        match flow {
            ControlFlow::None => Ok(Value::Null),
            ControlFlow::Return(value) => Ok(value),
            ControlFlow::Break | ControlFlow::Continue => Err(self.error_at(
                location,
                "loop control escaped a function body",
                Some("Use break and continue only directly inside a loop.".to_string()),
            )),
        }
    }

    fn imported_value(
        &self,
        imported: &ImportedValue,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        self.module_scopes
            .get(&imported.module_identity)
            .and_then(|scope| scope.vars.get(&imported.exported_name))
            .cloned()
            .ok_or_else(|| {
                self.error_at(
                    location,
                    "validated imported value was not initialized",
                    None,
                )
            })
    }

    fn namespace_value(
        &self,
        identity: &str,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let scope = self
            .module_scopes
            .get(identity)
            .ok_or_else(|| self.error_at(location, "module namespace was not initialized", None))?;
        let mut values = BTreeMap::new();
        for (name, kind) in &scope.exports {
            if *kind == ExportKind::Let
                && let Some(value) = scope.vars.get(name)
            {
                values.insert(name.clone(), value.clone());
            }
        }
        Ok(Value::Object(values))
    }

    fn namespace_export_value(
        &self,
        identity: &str,
        name: &str,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let scope = self
            .module_scopes
            .get(identity)
            .ok_or_else(|| self.error_at(location, "module namespace was not initialized", None))?;
        match scope.exports.get(name) {
            Some(ExportKind::Let) => scope.vars.get(name).cloned().ok_or_else(|| {
                self.error_at(
                    location,
                    "validated exported value was not initialized",
                    None,
                )
            }),
            Some(ExportKind::Function) => Err(self.error_at(
                location,
                format!(
                    "module '{}' export '{}' is a function and must be called",
                    identity, name
                ),
                None,
            )),
            None => Ok(Value::Null),
        }
    }

    fn capture_scope(&self) -> ModuleScope {
        ModuleScope {
            vars: self.vars.clone(),
            functions: self.functions.clone(),
            imported_values: self.imported_values.clone(),
            namespaces: self.namespaces.clone(),
            read_only_bindings: self.read_only_bindings.clone(),
            exports: BTreeMap::new(),
            source_lines: self.source_lines.clone(),
            filename: self.filename.clone().unwrap_or_default(),
        }
    }

    fn apply_scope(&mut self, scope: ModuleScope) {
        self.vars = scope.vars;
        self.functions = scope.functions;
        self.imported_values = scope.imported_values;
        self.namespaces = scope.namespaces;
        self.read_only_bindings = scope.read_only_bindings;
        self.source_lines = scope.source_lines;
        self.filename = Some(scope.filename);
    }

    fn restore_scope(&mut self, scope: ModuleScope) {
        self.apply_scope(scope);
    }

    fn restore_scope_preserving_vars(&mut self, scope: ModuleScope) {
        self.functions = scope.functions;
        self.imported_values = scope.imported_values;
        self.namespaces = scope.namespaces;
        self.read_only_bindings = scope.read_only_bindings;
        self.source_lines = scope.source_lines;
        self.filename = Some(scope.filename);
    }

    fn call_builtin(
        &mut self,
        name: &str,
        args: &[Expr],
        location: SourceLocation,
    ) -> Option<Result<Value, RuntimeError>> {
        match name {
            "length" => Some(self.length(args, location)),
            "is_empty" => Some(self.is_empty(args, location)),
            "contains" => Some(self.contains(args, location)),
            "get" => Some(self.get(args, location)),
            "keys" => Some(self.keys(args, location)),
            "values" => Some(self.values(args, location)),
            "entries" => Some(self.entries(args, location)),
            "json_parse" => {
                let input = self
                    .evaluate_builtin_arguments("json_parse", args, 1, 1, location)
                    .map(|values| values.into_iter().next().expect("one checked argument"));

                match input {
                    Ok(Value::Text(text)) => match serde_json::from_str::<JsonValue>(&text) {
                        Ok(json) => Some(Value::from_json(json).map_err(|message| {
                            self.error_at(location, format!("invalid JSON: {}", message), None)
                        })),
                        Err(error) => Some(Err(self.error_at(
                            location,
                            format!("invalid JSON: {}", error),
                            None,
                        ))),
                    },
                    Ok(_) => Some(Err(self.error_at(
                        location,
                        "json_parse expects a text value",
                        None,
                    ))),
                    Err(error) => Some(Err(error)),
                }
            }
            "json_stringify" => {
                let value = self
                    .evaluate_builtin_arguments("json_stringify", args, 1, 1, location)
                    .map(|values| values.into_iter().next().expect("one checked argument"));

                Some(value.map(|value| {
                    let json = value.to_json();
                    Value::Text(json.to_string())
                }))
            }
            "http_get" => {
                let input = self
                    .evaluate_builtin_arguments("http_get", args, 1, 1, location)
                    .map(|values| values.into_iter().next().expect("one checked argument"));

                match input {
                    Ok(Value::Text(url)) => Some(self.http_get(&url, location)),
                    Ok(_) => Some(Err(self.error_at(
                        location,
                        "http_get expects a text URL",
                        None,
                    ))),
                    Err(error) => Some(Err(error)),
                }
            }
            "http_post" => {
                let values = self.evaluate_builtin_arguments("http_post", args, 2, 2, location);
                let (url, body) = match values {
                    Ok(mut values) => (Ok(values.remove(0)), Ok(values.remove(0))),
                    Err(error) => (Err(error), Ok(Value::Null)),
                };

                match (url, body) {
                    (Ok(Value::Text(url)), Ok(Value::Text(body))) => {
                        Some(self.http_post(&url, &body, location))
                    }
                    (Ok(Value::Text(_)), Ok(_)) => Some(Err(self.error_at(
                        location,
                        "http_post expects a text body",
                        None,
                    ))),
                    (Ok(_), Ok(_)) => Some(Err(self.error_at(
                        location,
                        "http_post expects a text URL",
                        None,
                    ))),
                    (Err(error), _) | (_, Err(error)) => Some(Err(error)),
                }
            }
            "read_file" => {
                let input = self
                    .evaluate_builtin_arguments("read_file", args, 1, 1, location)
                    .map(|values| values.into_iter().next().expect("one checked argument"));

                match input {
                    Ok(Value::Text(path)) => Some(self.read_file(&path, location)),
                    Ok(_) => Some(Err(self.error_at(
                        location,
                        "read_file expects a text path",
                        None,
                    ))),
                    Err(error) => Some(Err(error)),
                }
            }
            "write_file" => {
                let values = self.evaluate_builtin_arguments("write_file", args, 2, 2, location);
                let (path, body) = match values {
                    Ok(mut values) => (Ok(values.remove(0)), Ok(values.remove(0))),
                    Err(error) => (Err(error), Ok(Value::Null)),
                };

                match (path, body) {
                    (Ok(Value::Text(path)), Ok(Value::Text(body))) => {
                        Some(self.write_file(&path, &body, location))
                    }
                    (Ok(Value::Text(_)), Ok(_)) => Some(Err(self.error_at(
                        location,
                        "write_file expects a text body",
                        None,
                    ))),
                    (Ok(_), Ok(_)) => Some(Err(self.error_at(
                        location,
                        "write_file expects a text path",
                        None,
                    ))),
                    (Err(error), _) | (_, Err(error)) => Some(Err(error)),
                }
            }
            "env" => {
                let input = self
                    .evaluate_builtin_arguments("env", args, 1, 1, location)
                    .map(|values| values.into_iter().next().expect("one checked argument"));

                match input {
                    Ok(Value::Text(name)) => {
                        if !self.policy.allow_env {
                            return Some(Err(self.error_at(
                                location,
                                "environment-variable access is disabled by execution policy",
                                None,
                            )));
                        }
                        let value = std::env::var(&name).unwrap_or_default();
                        Some(Ok(Value::Text(value)))
                    }
                    Ok(_) => Some(Err(self.error_at(
                        location,
                        "env expects a text variable name",
                        None,
                    ))),
                    Err(error) => Some(Err(error)),
                }
            }
            _ => None,
        }
    }

    fn length(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("length", args, 1, 1, location)?;
        let length = match &values[0] {
            Value::Text(value) => value.chars().count(),
            Value::Array(values) => values.len(),
            Value::Object(entries) => entries.len(),
            value => {
                return Err(self.error_at(
                    location,
                    format!(
                        "length expects a text, array, or object value, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
        };
        let length = i32::try_from(length).map_err(|_| {
            self.error_at(
                location,
                "length result exceeds SolveLang's signed 32-bit number range",
                None,
            )
        })?;
        Ok(Value::Number(length))
    }

    fn is_empty(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("is_empty", args, 1, 1, location)?;
        let is_empty = match &values[0] {
            Value::Text(value) => value.is_empty(),
            Value::Array(values) => values.is_empty(),
            Value::Object(entries) => entries.is_empty(),
            value => {
                return Err(self.error_at(
                    location,
                    format!(
                        "is_empty expects a text, array, or object value, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
        };
        Ok(Value::Bool(is_empty))
    }

    fn contains(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("contains", args, 2, 2, location)?;
        let contains = match (&values[0], &values[1]) {
            (Value::Text(text), Value::Text(needle)) => text.contains(needle),
            (Value::Text(_), value) => {
                return Err(self.error_at(
                    location,
                    format!(
                        "contains expects a text search value for text, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
            (Value::Array(values), needle) => values.contains(needle),
            (Value::Object(entries), Value::Text(key)) => entries.contains_key(key),
            (Value::Object(_), value) => {
                return Err(self.error_at(
                    location,
                    format!(
                        "contains expects a text key for an object, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
            (value, _) => {
                return Err(self.error_at(
                    location,
                    format!(
                        "contains expects a text, array, or object value, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
        };
        Ok(Value::Bool(contains))
    }

    fn get(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("get", args, 2, 3, location)?;
        let fallback = values.get(2).cloned().unwrap_or(Value::Null);
        match (&values[0], &values[1]) {
            (Value::Array(items), Value::Number(index)) => Ok(usize::try_from(*index)
                .ok()
                .and_then(|index| items.get(index).cloned())
                .unwrap_or(fallback)),
            (Value::Array(_), value) => Err(self.error_at(
                location,
                format!(
                    "get expects a number index for an array, got {}",
                    value.type_name()
                ),
                None,
            )),
            (Value::Object(entries), Value::Text(key)) => {
                Ok(entries.get(key).cloned().unwrap_or(fallback))
            }
            (Value::Object(_), value) => Err(self.error_at(
                location,
                format!(
                    "get expects a text key for an object, got {}",
                    value.type_name()
                ),
                None,
            )),
            (value, _) => Err(self.error_at(
                location,
                format!(
                    "get expects an array or object value, got {}",
                    value.type_name()
                ),
                None,
            )),
        }
    }

    fn keys(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("keys", args, 1, 1, location)?;
        match &values[0] {
            Value::Object(entries) => Ok(Value::Array(
                entries.keys().cloned().map(Value::Text).collect(),
            )),
            value => Err(self.error_at(
                location,
                format!("keys expects an object value, got {}", value.type_name()),
                None,
            )),
        }
    }

    fn values(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("values", args, 1, 1, location)?;
        match &values[0] {
            Value::Object(entries) => Ok(Value::Array(entries.values().cloned().collect())),
            value => Err(self.error_at(
                location,
                format!("values expects an object value, got {}", value.type_name()),
                None,
            )),
        }
    }

    fn entries(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("entries", args, 1, 1, location)?;
        match &values[0] {
            Value::Object(entries) => Ok(Value::Array(
                entries
                    .iter()
                    .map(|(key, value)| Value::Array(vec![Value::Text(key.clone()), value.clone()]))
                    .collect(),
            )),
            value => Err(self.error_at(
                location,
                format!("entries expects an object value, got {}", value.type_name()),
                None,
            )),
        }
    }

    fn evaluate_builtin_arguments(
        &mut self,
        name: &str,
        args: &[Expr],
        minimum: usize,
        maximum: usize,
        location: SourceLocation,
    ) -> Result<Vec<Value>, RuntimeError> {
        if args.len() < minimum || args.len() > maximum {
            let expected = if minimum == maximum {
                minimum.to_string()
            } else {
                format!("between {} and {}", minimum, maximum)
            };
            return Err(self.error_at(
                location,
                format!(
                    "{} expects {} argument{} but received {}",
                    name,
                    expected,
                    if maximum == 1 { "" } else { "s" },
                    args.len()
                ),
                None,
            ));
        }
        args.iter().map(|arg| self.eval(arg)).collect()
    }

    fn http_get(&self, url: &str, location: SourceLocation) -> Result<Value, RuntimeError> {
        if !self.policy.allow_network {
            return Err(self.error_at(
                location,
                "network access is disabled by execution policy",
                None,
            ));
        }

        let client = match Client::builder()
            .connect_timeout(self.policy.http_connect_timeout)
            .timeout(self.policy.http_request_timeout)
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                return Err(self.error_at(
                    location,
                    format!("could not create HTTP client: {}", error),
                    None,
                ));
            }
        };

        let response = match client.get(url).send() {
            Ok(response) => response,
            Err(error) => {
                return Err(self.http_request_error("http_get", &error, location));
            }
        };

        self.http_response_to_value(response, "http_get", location)
    }

    fn read_file(&self, path: &str, location: SourceLocation) -> Result<Value, RuntimeError> {
        if !self.policy.allow_file_read {
            return Err(self.error_at(
                location,
                "file read access is disabled by execution policy",
                None,
            ));
        }

        let path = self.resolve_existing_allowed_path(path)?;

        match std::fs::read_to_string(&path) {
            Ok(content) => Ok(Value::Text(content)),
            Err(error) => {
                Err(self.error_at(location, format!("read_file failed: {}", error), None))
            }
        }
    }

    fn write_file(
        &self,
        path: &str,
        body: &str,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        if !self.policy.allow_file_write {
            return Err(self.error_at(
                location,
                "file write access is disabled by execution policy",
                None,
            ));
        }

        let path = self.resolve_writable_allowed_path(path)?;

        match std::fs::write(&path, body) {
            Ok(_) => Ok(Value::Bool(true)),
            Err(error) => {
                Err(self.error_at(location, format!("write_file failed: {}", error), None))
            }
        }
    }

    fn http_post(
        &self,
        url: &str,
        body: &str,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        if !self.policy.allow_network {
            return Err(self.error_at(
                location,
                "network access is disabled by execution policy",
                None,
            ));
        }

        let client = match Client::builder()
            .connect_timeout(self.policy.http_connect_timeout)
            .timeout(self.policy.http_request_timeout)
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                return Err(self.error_at(
                    location,
                    format!("could not create HTTP client: {}", error),
                    None,
                ));
            }
        };

        let response = match client
            .post(url)
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                return Err(self.http_request_error("http_post", &error, location));
            }
        };

        self.http_response_to_value(response, "http_post", location)
    }

    fn http_response_to_value(
        &self,
        mut response: reqwest::blocking::Response,
        builtin: &str,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let status = response.status().as_u16() as i32;
        let final_url = response.url().to_string();

        let mut headers = BTreeMap::new();
        for (name, value) in response.headers().iter() {
            headers.insert(
                name.to_string(),
                Value::Text(value.to_str().unwrap_or("").to_string()),
            );
        }

        let read_limit = self
            .policy
            .http_max_body_bytes
            .checked_add(1)
            .and_then(|limit| u64::try_from(limit).ok())
            .ok_or_else(|| {
                self.error_at(
                    location,
                    "HTTP response body limit is too large",
                    Some("Use a smaller --http-max-body-bytes value.".to_string()),
                )
            })?;
        let mut limited = response.by_ref().take(read_limit);
        let mut body_bytes = Vec::new();

        match limited.read_to_end(&mut body_bytes) {
            Ok(_) => {}
            Err(error) => {
                return Err(self.error_at(
                    location,
                    format!("could not read HTTP response body: {}", error),
                    None,
                ));
            }
        };

        if body_bytes.len() > self.policy.http_max_body_bytes {
            return Err(self.error_at(
                location,
                format!(
                    "{} response body exceeded {} bytes",
                    builtin, self.policy.http_max_body_bytes
                ),
                None,
            ));
        }

        let body = String::from_utf8_lossy(&body_bytes).to_string();

        let mut result = BTreeMap::new();
        result.insert("status".to_string(), Value::Number(status));
        result.insert("url".to_string(), Value::Text(final_url));
        result.insert("body".to_string(), Value::Text(body));
        result.insert("headers".to_string(), Value::Object(headers));

        Ok(Value::Object(result))
    }

    fn http_request_error(
        &self,
        builtin: &str,
        error: &reqwest::Error,
        location: SourceLocation,
    ) -> RuntimeError {
        if error.is_timeout() {
            self.error_at(
                location,
                format!(
                    "{} timed out after {} ms",
                    builtin,
                    self.policy.http_request_timeout.as_millis()
                ),
                None,
            )
        } else {
            self.error_at(location, format!("{} failed: {}", builtin, error), None)
        }
    }

    fn resolve_existing_allowed_path(&self, path: &str) -> Result<PathBuf, RuntimeError> {
        self.reject_path_traversal(path)?;
        let canonical = std::fs::canonicalize(path).map_err(|error| {
            RuntimeError::new(format!("failed to resolve '{}': {}", path, error))
        })?;
        self.ensure_path_in_allowed_roots(&canonical)?;
        Ok(canonical)
    }

    fn resolve_writable_allowed_path(&self, path: &str) -> Result<PathBuf, RuntimeError> {
        self.reject_path_traversal(path)?;
        let path = PathBuf::from(path);
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        let canonical_parent = std::fs::canonicalize(parent).map_err(|error| {
            RuntimeError::new(format!(
                "failed to resolve parent directory '{}': {}",
                parent.display(),
                error
            ))
        })?;
        self.ensure_path_in_allowed_roots(&canonical_parent)?;

        let file_name = path
            .file_name()
            .ok_or_else(|| RuntimeError::new(format!("invalid file path '{}'", path.display())))?;

        let candidate = canonical_parent.join(file_name);
        if self.policy.restrict_filesystem_roots {
            match std::fs::symlink_metadata(&candidate) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(RuntimeError::new(format!(
                        "refusing to write through symbolic link '{}'",
                        candidate.display()
                    )));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(RuntimeError::new(format!(
                        "failed to inspect output path '{}': {}",
                        candidate.display(),
                        error
                    )));
                }
            }
        }
        Ok(candidate)
    }

    fn reject_path_traversal(&self, path: &str) -> Result<(), RuntimeError> {
        if self.policy.restrict_filesystem_roots
            && Path::new(path)
                .components()
                .any(|component| matches!(component, Component::ParentDir))
        {
            Err(RuntimeError::new(format!(
                "path traversal is not allowed: '{}'",
                path
            )))
        } else {
            Ok(())
        }
    }

    fn ensure_path_in_allowed_roots(&self, path: &Path) -> Result<(), RuntimeError> {
        if !self.policy.restrict_filesystem_roots {
            return Ok(());
        }

        if self.policy.allowed_roots.is_empty() {
            return Err(RuntimeError::new(
                "filesystem access requires at least one allowed root",
            ));
        }

        if self
            .policy
            .allowed_roots
            .iter()
            .any(|root| path.starts_with(root))
        {
            Ok(())
        } else {
            Err(RuntimeError::new(format!(
                "path '{}' is outside allowed filesystem roots",
                path.display()
            )))
        }
    }

    fn ask_agent(
        &self,
        name: &str,
        message: &Value,
        location: SourceLocation,
    ) -> Result<String, RuntimeError> {
        let agent = match self.agents.get(name) {
            Some(agent) => agent,
            None => {
                return Err(self.error_at(location, format!("unknown agent '{}'", name), None));
            }
        };

        if !self.policy.allow_env {
            return Err(self.error_at(
                location,
                "environment-variable access is disabled by execution policy",
                None,
            ));
        }

        if !self.policy.allow_network
            && std::env::var("SOLVELANG_AI_PROVIDER")
                .map(|provider| provider.trim().eq_ignore_ascii_case("openai"))
                .unwrap_or(false)
        {
            return Err(self.error_at(
                location,
                "network access is disabled by execution policy",
                None,
            ));
        }

        ai::ask_agent(name, &agent.instruction, &agent.tools, &message.to_string())
            .map_err(|error| self.error_at(location, error.to_string(), None))
    }
}

fn first_explicit_module_location(statements: &[Stmt]) -> Option<SourceLocation> {
    statements.iter().find_map(|statement| match statement {
        Stmt::ModuleImport { location, .. }
        | Stmt::NamedModuleImport { location, .. }
        | Stmt::Export { location, .. } => Some(*location),
        Stmt::Function { body, .. } => first_explicit_module_location(body),
        Stmt::While {
            condition, body, ..
        } => first_explicit_module_expression_location(condition)
            .or_else(|| first_explicit_module_location(body)),
        Stmt::For { iterable, body, .. } => first_explicit_module_expression_location(iterable)
            .or_else(|| first_explicit_module_location(body)),
        Stmt::If {
            condition,
            then_branch,
            else_branch,
            ..
        } => first_explicit_module_expression_location(condition)
            .or_else(|| first_explicit_module_location(then_branch))
            .or_else(|| first_explicit_module_location(else_branch)),
        Stmt::Let { value, .. }
        | Stmt::Assign { value, .. }
        | Stmt::Print { value, .. }
        | Stmt::Return { value, .. }
        | Stmt::Expr(value) => first_explicit_module_expression_location(value),
        Stmt::Ask { message, .. } => first_explicit_module_expression_location(message),
        Stmt::LegacyInclude { .. }
        | Stmt::Break { .. }
        | Stmt::Continue { .. }
        | Stmt::Agent { .. } => None,
    })
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
        Stmt::Expr(expression) => expression.location,
    }
}

fn first_call_location(expression: &Expr) -> Option<SourceLocation> {
    match &expression.kind {
        ExprKind::Call { .. } | ExprKind::ModuleCall { .. } => Some(expression.location),
        ExprKind::Array(values) => values.iter().find_map(first_call_location),
        ExprKind::Object(entries) => entries.values().find_map(first_call_location),
        ExprKind::Property(target, _) | ExprKind::Unary { expr: target, .. } => {
            first_call_location(target)
        }
        ExprKind::Index(target, index) => {
            first_call_location(target).or_else(|| first_call_location(index))
        }
        ExprKind::Binary { left, right, .. } => {
            first_call_location(left).or_else(|| first_call_location(right))
        }
        ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => None,
    }
}

fn first_explicit_module_expression_location(expr: &Expr) -> Option<SourceLocation> {
    match &expr.kind {
        ExprKind::ModuleCall { .. } => Some(expr.location),
        ExprKind::Array(values) => values
            .iter()
            .find_map(first_explicit_module_expression_location),
        ExprKind::Object(entries) => entries
            .values()
            .find_map(first_explicit_module_expression_location),
        ExprKind::Property(target, _) | ExprKind::Unary { expr: target, .. } => {
            first_explicit_module_expression_location(target)
        }
        ExprKind::Index(target, index) => first_explicit_module_expression_location(target)
            .or_else(|| first_explicit_module_expression_location(index)),
        ExprKind::Binary { left, right, .. } => first_explicit_module_expression_location(left)
            .or_else(|| first_explicit_module_expression_location(right)),
        ExprKind::Call { args, .. } => args
            .iter()
            .find_map(first_explicit_module_expression_location),
        ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    #[cfg(unix)]
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    #[cfg(unix)]
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{AstRuntime, ExecutionPolicy, ModuleInitializationStatus};
    use crate::lexer::lex;
    use crate::parser::Parser;
    use crate::value::Value;

    fn parse(source: &str) -> Vec<crate::ast::Stmt> {
        let mut parser = Parser::new(lex(source));
        parser.parse().expect("parse succeeds")
    }

    #[cfg(unix)]
    fn module_fixture(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "solvelang_runtime_module_{name}_{}_{}",
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&root).expect("fixture root");
        root
    }

    #[cfg(unix)]
    #[test]
    fn resolved_modules_bind_exports_without_leaking_private_scope() {
        let root = module_fixture("bindings");
        let entry = root.join("entry.solve");
        let module = root.join("math.solve");
        let entry_source = r#"
import "math.solve" as math
import { base as initial, add } from "math.solve"
print(initial)
print(math.base)
print(add(2, 3))
print(math.add(3, 4))
"#;
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(
            &module,
            "let private = 10\nexport let base = 4\nexport fn add(left, right) { return left + right + private }\n",
        )
        .expect("module source");

        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        fs::write(
            &module,
            "print(\"must-not-be-read\")\nexport let base = 999\n",
        )
        .expect("mutate module after graph resolution");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect("module runtime succeeds");

        assert_eq!(
            runtime.outputs(),
            &[
                Value::Number(4),
                Value::Number(4),
                Value::Number(15),
                Value::Number(17)
            ]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn exported_lets_remain_live_after_exported_function_calls() {
        let root = module_fixture("live_exports");
        let entry = root.join("entry.solve");
        let module = root.join("counter.solve");
        let entry_source = r#"
import "counter.solve" as counter
import { count as named_count, increment } from "counter.solve"
print(named_count)
print(increment())
print(named_count)
print(counter.count)
print(counter.increment())
print(named_count)
print(counter.increment_from(named_count))
print(named_count)
"#;
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(
            &module,
            "export let count = 1\nexport fn increment() { count = count + 1 return count }\nexport fn increment_from(count) { count = count + 1 return count }\n",
        )
        .expect("module source");

        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect("module runtime succeeds");

        assert_eq!(
            runtime.outputs(),
            &[
                Value::Number(1),
                Value::Number(2),
                Value::Number(2),
                Value::Number(2),
                Value::Number(3),
                Value::Number(3),
                Value::Number(4),
                Value::Number(3),
            ]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn canonical_modules_initialize_once_and_all_import_forms_share_state() {
        let root = module_fixture("exactly_once_diamond");
        let entry = root.join("entry.solve");
        let entry_source = r#"
import "a.solve" as a
import "b.solve" as b
import "state.solve" as state
import { value, bump } from "./state.solve"
print(a.bump_shared())
print(b.bump_shared())
print(value)
print(state.value)
print(bump())
"#;
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(
            root.join("a.solve"),
            "import { bump } from \"state.solve\"\nexport fn bump_shared() { return bump() }\n",
        )
        .expect("a module");
        fs::write(
            root.join("b.solve"),
            "import \"./state.solve\" as state\nexport fn bump_shared() { return state.bump() }\n",
        )
        .expect("b module");
        fs::write(
            root.join("state.solve"),
            "export let value = 0\nexport fn bump() { value = value + 1 return value }\n",
        )
        .expect("state module");

        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let repeated_graph =
            crate::module_resolver::resolve_explicit_modules(&entry).expect("repeated graph");
        assert_eq!(
            graph.order,
            vec!["state.solve", "a.solve", "b.solve", "entry.solve"]
        );
        assert_eq!(graph.order, repeated_graph.order);
        assert_eq!(
            graph
                .order
                .iter()
                .filter(|identity| identity.as_str() == "state.solve")
                .count(),
            1
        );
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect("module runtime succeeds");
        assert_eq!(
            runtime.outputs(),
            &[
                Value::Number(1),
                Value::Number(2),
                Value::Number(2),
                Value::Number(2),
                Value::Number(3),
            ]
        );
        assert_eq!(
            runtime.module_initialization.get("state.solve"),
            Some(&ModuleInitializationStatus::Initialized)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn failed_module_initialization_rolls_back_the_whole_initialization_phase() {
        let root = module_fixture("initialization_transaction");
        let entry = root.join("entry.solve");
        let entry_source = "import \"dependent.solve\" as dependent\nprint(\"MUST NOT PRINT\")\n";
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(
            root.join("shared.solve"),
            "export let partial = 1\nprint(\"MUST NOT PRINT\")\n",
        )
        .expect("failing dependency");
        fs::write(
            root.join("dependent.solve"),
            "import { partial } from \"shared.solve\"\nexport let value = partial\n",
        )
        .expect("dependent module");

        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect_err("module initialization fails atomically");
        assert!(runtime.outputs().is_empty());
        assert!(runtime.module_scopes.is_empty());
        assert!(runtime.module_initialization.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn nested_module_calls_share_live_state_without_committing_local_shadows() {
        let root = module_fixture("nested_live_state");
        let entry = root.join("entry.solve");
        let module = root.join("counter.solve");
        let entry_source = r#"
import "counter.solve" as counter
import { count as named_count, twice, update_then_read, local_shadow, loop_shadow, block_shadow, parameter_shadow } from "counter.solve"
print(twice())
print(named_count)
print(counter.count)
print(update_then_read())
print(named_count)
print(local_shadow())
print(named_count)
print(loop_shadow())
print(named_count)
print(block_shadow())
print(named_count)
print(parameter_shadow(12))
print(named_count)
"#;
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(
            &module,
            r#"
export let count = 0
fn increment() { count = count + 1 }
fn read() { return count }
export fn twice() { increment() increment() return count }
export fn update_then_read() { count = 5 return read() }
export fn local_shadow() { let count = 9 return count }
export fn loop_shadow() { for count in [7] {} return count }
export fn block_shadow() { if true { let count = 11 } return count }
export fn parameter_shadow(count) { count = count + 1 return count }
"#,
        )
        .expect("module source");

        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect("module runtime succeeds");

        assert_eq!(
            runtime.outputs(),
            &[
                Value::Number(2),
                Value::Number(2),
                Value::Number(2),
                Value::Number(5),
                Value::Number(5),
                Value::Number(9),
                Value::Number(5),
                Value::Number(5),
                Value::Number(5),
                Value::Number(5),
                Value::Number(5),
                Value::Number(13),
                Value::Number(5),
            ]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn nested_same_module_failure_rolls_back_the_outermost_call_chain() {
        let root = module_fixture("nested_call_transaction");
        let entry = root.join("entry.solve");
        let entry_source = "import \"counter.solve\" as counter\ncounter.fail_outer()\n";
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(
            root.join("counter.solve"),
            r#"
export let count = 1
fn first() { count = count + 2 }
fn second() { count = count + 3 }
export fn fail_outer() { count = count + 1 first() second() return 1 / 0 }
"#,
        )
        .expect("counter module");
        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect_err("outer failure rolls back nested mutations");
        assert_eq!(
            runtime.module_scopes["counter.solve"].vars["count"],
            Value::Number(1)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn imported_bindings_are_read_only_but_lexical_shadows_remain_local() {
        let root = module_fixture("import_shadows");
        let entry = root.join("entry.solve");
        let entry_source = r#"
import { value } from "state.solve"
fn parameter(value) { value = value + 1 return value }
fn local() { let value = 8 value = value + 1 return value }
fn block() { if true { let value = 10 value = value + 1 return value } return 0 }
fn loop() { for value in [12] { value = value + 1 return value } return 0 }
print(parameter(4))
print(local())
print(block())
print(loop())
print(value)
"#;
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(root.join("state.solve"), "export let value = 2\n").expect("state module");
        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect("lexical shadows are legal");
        assert_eq!(
            runtime.outputs(),
            &[
                Value::Number(5),
                Value::Number(9),
                Value::Number(11),
                Value::Number(13),
                Value::Number(2),
            ]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn namespace_and_top_level_loop_shadows_resolve_lexically() {
        let root = module_fixture("namespace_and_loop_shadows");
        let entry = root.join("entry.solve");
        let entry_source = r#"
import "state.solve" as state
import { value } from "state.solve"
fn read(state) { return state.value }
fn inner() { return state.value }
fn outer(state) { return inner() }
print(read({ value: 7 }))
print(outer({ value: 9 }))
for value in [8] { print(value) }
print(state.value)
print(value)
"#;
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(root.join("state.solve"), "export let value = 2\n").expect("state module");
        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect("lexical namespace and loop shadows win");
        assert_eq!(
            runtime.outputs(),
            &[
                Value::Number(7),
                Value::Number(2),
                Value::Number(8),
                Value::Number(2),
                Value::Number(2),
            ]
        );
        assert!(!runtime.vars.contains_key("value"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn named_function_shadows_fail_closed_without_module_side_effects() {
        let root = module_fixture("named_function_shadow");
        let entry = root.join("entry.solve");
        let entry_source =
            "import { run } from \"state.solve\"\nfn wrapper(run) { run() }\nwrapper(1)\n";
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(
            root.join("state.solve"),
            "export let count = 0\nexport fn run() { count = count + 1 }\n",
        )
        .expect("state module");
        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        let error = runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect_err("shadowed imported function is not dispatched");
        assert!(
            error
                .to_string()
                .contains("lexical binding 'run' is not callable")
        );
        assert_eq!(
            runtime.module_scopes["state.solve"].vars["count"],
            Value::Number(0)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn reused_runtime_starts_a_fresh_module_initialization_epoch() {
        let first_root = module_fixture("first_runtime_graph");
        let second_root = module_fixture("second_runtime_graph");
        let entry_source = "import \"state.solve\" as state\nprint(state.value)\n";
        for (root, value) in [(&first_root, 1), (&second_root, 2)] {
            fs::write(root.join("entry.solve"), entry_source).expect("entry source");
            fs::write(
                root.join("state.solve"),
                format!("export let value = {value}\n"),
            )
            .expect("state module");
        }
        let first_graph =
            crate::module_resolver::resolve_explicit_modules(&first_root.join("entry.solve"))
                .expect("first graph");
        let second_graph =
            crate::module_resolver::resolve_explicit_modules(&second_root.join("entry.solve"))
                .expect("second graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        runtime
            .run_with_modules(&first_graph, &parse(entry_source))
            .expect("first graph runs");
        runtime
            .run_with_modules(&second_graph, &parse(entry_source))
            .expect("second graph runs independently");
        assert_eq!(runtime.outputs(), &[Value::Number(1), Value::Number(2)]);
        assert_eq!(
            runtime.module_scopes["state.solve"].vars["value"],
            Value::Number(2)
        );
        let _ = fs::remove_dir_all(first_root);
        let _ = fs::remove_dir_all(second_root);
    }

    #[cfg(unix)]
    #[test]
    fn imported_runtime_errors_keep_module_line_and_column_provenance() {
        let root = module_fixture("error_provenance");
        let module_source =
            "fn private() {\n  return 1 / 0\n}\nexport fn fail() { return private() }\n";
        fs::write(root.join("math.solve"), module_source).expect("math module");

        for entry_source in [
            "import \"math.solve\" as math\nmath.fail()\n",
            "import { fail } from \"math.solve\"\nfail()\n",
        ] {
            let entry = root.join("entry.solve");
            fs::write(&entry, entry_source).expect("entry source");
            let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
            let mut runtime = AstRuntime::with_input(
                ExecutionPolicy::safe(Vec::new()),
                entry_source,
                "entry.solve",
                None,
                true,
            );
            let error = runtime
                .run_with_modules(&graph, &parse(entry_source))
                .expect_err("imported call fails");
            let rendered = error.to_string();
            assert!(
                rendered.contains("on line 2, column 12 in math.solve"),
                "{rendered}"
            );
            assert!(rendered.contains("return 1 / 0"), "{rendered}");
            assert!(!rendered.contains("entry.solve at 1:1"), "{rendered}");
        }
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn module_function_failures_and_cross_module_calls_keep_state_isolated() {
        let root = module_fixture("cross_module_state");
        let entry = root.join("entry.solve");
        let left = root.join("left.solve");
        let right = root.join("right.solve");
        let entry_source = r#"
import "left.solve" as left
import "right.solve" as right
print(left.bump_twice())
print(left.count)
print(right.count)
left.fail_after_right_success()
"#;
        fs::write(&entry, entry_source).expect("entry source");
        fs::write(
            &left,
            r#"
import "right.solve" as right
export let count = 0
export fn bump_twice() { count = count + 1 right.bump() count = count + 1 return count }
export fn fail_after_update() { count = 99 return 1 / 0 }
export fn fail_after_right_success() { count = 99 right.bump() return 1 / 0 }
"#,
        )
        .expect("left module");
        fs::write(
            &right,
            "export let count = 100\nexport fn bump() { count = count + 1 return count }\n",
        )
        .expect("right module");

        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );
        let error = runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect_err("failing exported function is rejected");
        assert!(error.to_string().contains("divide by zero"), "{error}");
        assert_eq!(
            runtime.outputs(),
            &[Value::Number(2), Value::Number(2), Value::Number(101)]
        );
        assert_eq!(
            runtime.module_scopes["left.solve"].vars["count"],
            Value::Number(2)
        );
        assert_eq!(
            runtime.module_scopes["right.solve"].vars["count"],
            Value::Number(102)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn resolved_module_initialization_rejects_execution_and_read_only_import_writes() {
        let root = module_fixture("boundaries");
        let entry = root.join("entry.solve");
        let module = root.join("module.solve");
        fs::write(
            &entry,
            "import { value } from \"module.solve\"\nvalue = 2\n",
        )
        .expect("entry source");
        fs::write(&module, "export let value = 1\n").expect("module source");
        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            "import { value } from \"module.solve\"\nvalue = 2\n",
            "entry.solve",
            None,
            true,
        );
        let error = runtime
            .run_with_modules(
                &graph,
                &parse("import { value } from \"module.solve\"\nvalue = 2\n"),
            )
            .expect_err("import binding is read-only");
        assert!(
            error
                .to_string()
                .contains("imported binding 'value' is read-only")
        );
        assert!(runtime.outputs().is_empty());

        fs::write(&module, "print(\"must-not-print\")\nexport let value = 1\n")
            .expect("module source");
        let graph = crate::module_resolver::resolve_explicit_modules(&entry).expect("graph");
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            "import { value } from \"module.solve\"\nprint(value)\n",
            "entry.solve",
            None,
            true,
        );
        let error = runtime
            .run_with_modules(
                &graph,
                &parse("import { value } from \"module.solve\"\nprint(value)\n"),
            )
            .expect_err("module top-level execution is rejected");
        assert!(
            error
                .to_string()
                .contains("module top level may contain only imports")
        );
        assert!(runtime.outputs().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn evaluates_variables_math_conditionals_functions_loops_arrays_objects_and_json() {
        let statements = parse(
            r#"
let total = 1 + 2 * 3
let ok = total == 7 and not false
let values = [total, 9]
let user = { name: "Saiid", active: ok }
fn pick(items) {
    return items[0]
}
let picked = pick(values)
let count = 0
while count < 2 {
    count = count + 1
}
for value in values {
    count = count + value
}
let parsed = json_parse("{\"name\":\"SolveLang\",\"count\":2}")
let encoded = json_stringify({ name: parsed.name, count: count })
if user.active {
    let result = picked + parsed.count
} else {
    let result = 0
}
"#,
        );
        let mut runtime = AstRuntime::default();

        runtime.run(&statements).expect("runtime succeeds");
    }

    #[test]
    fn stops_while_loops_before_an_eleventh_thousandth_body_execution() {
        let statements = parse(
            r#"
let count = 0
while true {
    count = count + 1
    if count > 10000 { break }
}
"#,
        );
        let mut runtime = AstRuntime::default();

        let error = runtime
            .run(&statements)
            .expect_err("loop limit is enforced");

        assert!(
            error
                .to_string()
                .contains("loop stopped after 10000 iterations")
        );
    }

    #[test]
    fn evaluates_pure_collection_and_text_helpers() {
        let source = r#"
let owners = ["Ari", "Bea"]
let ticket = { status: "open", count: 2 }
print(length(owners))
print(length("hé"))
print(length(ticket))
print(is_empty(""))
print(is_empty(owners))
print(is_empty({}))
print(contains(owners, "Bea"))
print(contains("SolveLang", "Lang"))
print(contains(ticket, "status"))
print(get(owners, 1))
print(get(ticket, "missing", "fallback"))
print(get(owners, 8, "fallback"))
print(keys(ticket))
print(values(ticket))
print(entries(ticket))
"#;
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            source,
            "helpers.solve",
            None,
            true,
        );

        runtime.run(&parse(source)).expect("pure helpers succeed");
        assert_eq!(
            runtime.outputs(),
            &[
                Value::Number(2),
                Value::Number(2),
                Value::Number(2),
                Value::Bool(true),
                Value::Bool(false),
                Value::Bool(true),
                Value::Bool(true),
                Value::Bool(true),
                Value::Bool(true),
                Value::Text("Bea".to_string()),
                Value::Text("fallback".to_string()),
                Value::Text("fallback".to_string()),
                Value::Array(vec![
                    Value::Text("count".to_string()),
                    Value::Text("status".to_string()),
                ]),
                Value::Array(vec![Value::Number(2), Value::Text("open".to_string())]),
                Value::Array(vec![
                    Value::Array(vec![Value::Text("count".to_string()), Value::Number(2)]),
                    Value::Array(vec![
                        Value::Text("status".to_string()),
                        Value::Text("open".to_string()),
                    ]),
                ]),
            ]
        );
    }

    #[test]
    fn pure_collection_helpers_report_typed_errors() {
        for (source, expected) in [
            (
                "print(length(1))",
                "length expects a text, array, or object value",
            ),
            (
                "print(is_empty(1))",
                "is_empty expects a text, array, or object value",
            ),
            (
                "print(contains(\"1\", 1))",
                "contains expects a text search value for text",
            ),
            (
                "print(contains({ status: true }, 1))",
                "contains expects a text key for an object",
            ),
            (
                "print(get(\"text\", 0))",
                "get expects an array or object value",
            ),
            (
                "print(get([1], \"0\"))",
                "get expects a number index for an array",
            ),
            ("print(keys([1]))", "keys expects an object value"),
            ("print(values([1]))", "values expects an object value"),
            ("print(entries([1]))", "entries expects an object value"),
            (
                "print(length(\"one\", \"two\"))",
                "length expects 1 argument but received 2",
            ),
            (
                "print(is_empty(\"one\", \"two\"))",
                "is_empty expects 1 argument but received 2",
            ),
            (
                "print(keys({ one: 1 }, { two: 2 }))",
                "keys expects 1 argument but received 2",
            ),
            (
                "print(values({ one: 1 }, { two: 2 }))",
                "values expects 1 argument but received 2",
            ),
            (
                "print(entries({ one: 1 }, { two: 2 }))",
                "entries expects 1 argument but received 2",
            ),
        ] {
            let mut runtime = AstRuntime::with_input(
                ExecutionPolicy::safe(Vec::new()),
                source,
                "helpers.solve",
                None,
                false,
            );
            let error = runtime
                .run(&parse(source))
                .expect_err("invalid helper arguments should fail");
            assert!(
                error.to_string().contains(expected),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn iterates_arrays_in_nested_loops_and_propagates_returns() {
        let statements = parse(
            r#"
fn first_match(groups) {
    for group in groups {
        for value in group {
            if value == 3 {
                return value
            }
        }
    }
    return 0
}
let result = first_match([[1, 2], [3, 4]])
print(result)
"#,
        );
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::unrestricted(),
            "",
            "test.solve",
            None,
            true,
        );

        runtime.run(&statements).expect("runtime succeeds");
        assert_eq!(runtime.outputs(), &[Value::Number(3)]);
    }

    #[test]
    fn break_and_continue_target_only_the_innermost_loop() {
        let statements = parse(
            r#"
let total = 0
let outer = 0
while outer < 3 {
    outer = outer + 1
    let inner = 0
    while inner < 4 {
        inner = inner + 1
        if inner == 2 {
            continue
        }
        if inner == 4 {
            break
        }
        total = total + outer * 10 + inner
    }
}
print(total)
"#,
        );
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::unrestricted(),
            "",
            "test.solve",
            None,
            true,
        );

        runtime.run(&statements).expect("loop control succeeds");
        assert_eq!(runtime.outputs(), &[Value::Number(132)]);
    }

    #[test]
    fn loop_control_preserves_function_return_propagation() {
        let statements = parse(
            r#"
fn first_after_skip(values) {
    for value in values {
        if value == 1 {
            continue
        }
        return value
    }
    return 0
}
print(first_after_skip([1, 4, 9]))
"#,
        );
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::unrestricted(),
            "",
            "test.solve",
            None,
            true,
        );

        runtime
            .run(&statements)
            .expect("return should leave the loop and function");
        assert_eq!(runtime.outputs(), &[Value::Number(4)]);
    }

    #[test]
    fn reports_a_source_located_error_for_non_array_for_iterables() {
        let source = "for item in 42 { print(item) }\n";
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::unrestricted(),
            source,
            "for.solve",
            None,
            false,
        );
        let error = runtime
            .run(&parse(source))
            .expect_err("non-array iterables should fail");

        assert!(
            error
                .to_string()
                .contains("for loops require an array iterable")
        );
        assert!(
            error
                .to_string()
                .contains("on line 1, column 13 in for.solve")
        );
    }

    #[test]
    fn reports_unknown_variables_and_divide_by_zero() {
        let mut runtime = AstRuntime::default();
        let unknown = runtime
            .run(&parse("print(missing)\n"))
            .expect_err("unknown variable should fail");
        assert!(unknown.to_string().contains("unknown variable 'missing'"));

        let mut runtime = AstRuntime::default();
        let divide = runtime
            .run(&parse("print(10 / 0)\n"))
            .expect_err("divide by zero should fail");
        assert!(divide.to_string().contains("divide by zero"));
    }

    #[test]
    fn module_calls_fail_before_any_prior_output() {
        let source = "print(\"must-not-print\")\nmissing.call()\n";
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::unrestricted(),
            source,
            "module-call.solve",
            None,
            true,
        );
        let error = runtime
            .run(&parse(source))
            .expect_err("module calls are unresolved");

        assert!(
            error
                .to_string()
                .contains("explicit local modules are not executable")
        );
        assert!(runtime.outputs().is_empty());
    }

    #[test]
    fn reports_checked_integer_overflow_for_every_arithmetic_operator() {
        let input = Value::Object(BTreeMap::from([
            ("max".to_string(), Value::Number(i32::MAX)),
            ("min".to_string(), Value::Number(i32::MIN)),
            ("minus_one".to_string(), Value::Number(-1)),
            ("two".to_string(), Value::Number(2)),
        ]));

        for (operator, source) in [
            ("+", "print(input.max + 1)\n"),
            ("-", "print(input.min - 1)\n"),
            ("*", "print(input.max * input.two)\n"),
            ("/", "print(input.min / input.minus_one)\n"),
        ] {
            let mut runtime = AstRuntime::with_input(
                ExecutionPolicy::safe(Vec::new()),
                source,
                "overflow.solve",
                Some(input.clone()),
                true,
            );
            let error = runtime
                .run(&parse(source))
                .expect_err("overflow must return a runtime error");

            assert!(
                error
                    .to_string()
                    .contains(&format!("integer overflow for operator '{}'", operator)),
                "unexpected error: {error}"
            );
            assert!(runtime.outputs().is_empty());
        }
    }

    #[cfg(unix)]
    #[test]
    fn restricted_file_writes_reject_existing_symlinks() {
        let root = std::env::temp_dir().join(format!(
            "solvelang_write_symlink_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is valid")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("temporary root is created");
        let outside = root.with_extension("outside");
        fs::write(&outside, "outside").expect("outside file is created");
        let link = root.join("escape.txt");
        symlink(&outside, &link).expect("symlink is created");

        let mut policy = ExecutionPolicy::unrestricted();
        policy.allowed_roots = vec![fs::canonicalize(&root).expect("root canonicalizes")];
        policy.restrict_filesystem_roots = true;
        let source = format!("write_file(\"{}\", \"overwritten\")", link.display());
        let mut runtime = AstRuntime::with_input(policy, &source, "write.solve", None, false);
        let error = runtime
            .run(&parse(&source))
            .expect_err("restricted writes must reject a symlink target");

        assert!(
            error
                .to_string()
                .contains("refusing to write through symbolic link")
        );
        assert_eq!(
            fs::read_to_string(&outside).expect("outside file is readable"),
            "outside"
        );
        fs::remove_dir_all(&root).expect("temporary root is removed");
        fs::remove_file(&outside).expect("outside file is removed");
    }
}
