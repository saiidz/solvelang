use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use reqwest::blocking::Client;
use serde_json::Value as JsonValue;

use crate::ai;
use crate::ast::{BinaryOp, Expr, ExprKind, SourceLocation, Stmt, UnaryOp};
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
    params: Vec<String>,
    body: Vec<Stmt>,
}

#[derive(Clone, Debug)]
struct Agent {
    instruction: String,
    tools: Vec<String>,
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
        self.execute_block(statements).map(|_| ())
    }

    fn execute_block(&mut self, statements: &[Stmt]) -> Result<Option<Value>, RuntimeError> {
        for statement in statements {
            if let Some(value) = self.execute(statement)? {
                return Ok(Some(value));
            }
        }

        Ok(None)
    }

    fn execute(&mut self, statement: &Stmt) -> Result<Option<Value>, RuntimeError> {
        match statement {
            Stmt::Let {
                name,
                value,
                location,
            } => {
                if self.input_injected && name == "input" {
                    return Err(self.error_at(
                        *location,
                        "the injected input value is read-only",
                        None,
                    ));
                }
                let value = self.eval(value)?;
                self.vars.insert(name.clone(), value);
                Ok(None)
            }
            Stmt::Assign {
                name,
                value,
                location,
            } => {
                if self.input_injected && name == "input" {
                    return Err(self.error_at(
                        *location,
                        "the injected input value is read-only",
                        None,
                    ));
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
                Ok(None)
            }
            Stmt::Print { value, .. } => {
                let value = self.eval(value)?;
                self.emit(value);
                Ok(None)
            }
            Stmt::Return { value, .. } => Ok(Some(self.eval(value)?)),
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
                        params: params.clone(),
                        body: body.clone(),
                    },
                );
                Ok(None)
            }
            Stmt::If {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                if self.eval(condition)?.is_truthy() {
                    self.execute_block(then_branch)
                } else {
                    self.execute_block(else_branch)
                }
            }
            Stmt::While {
                condition,
                body,
                location,
            } => {
                let mut safety_counter = 0;

                while self.eval(condition)?.is_truthy() {
                    if let Some(value) = self.execute_block(body)? {
                        return Ok(Some(value));
                    }

                    safety_counter += 1;
                    if safety_counter > 10_000 {
                        return Err(self.error_at(
                            *location,
                            "loop stopped after 10000 iterations",
                            Some(
                                "Review the loop condition or add a terminating update."
                                    .to_string(),
                            ),
                        ));
                    }
                }

                Ok(None)
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
                    self.vars.insert(name.clone(), value);
                    if let Some(value) = self.execute_block(body)? {
                        return Ok(Some(value));
                    }
                }
                Ok(None)
            }
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
                Ok(None)
            }
            Stmt::Ask {
                agent,
                message,
                location,
            } => {
                let message_value = self.eval(message)?;
                let response = self.ask_agent(agent, &message_value, *location)?;
                self.emit(Value::Text(response));
                Ok(None)
            }
            Stmt::Expr(expr) => {
                self.eval(expr)?;
                Ok(None)
            }
        }
    }

    fn eval(&mut self, expr: &Expr) -> Result<Value, RuntimeError> {
        match &expr.kind {
            ExprKind::Number(value) => Ok(Value::Number(*value)),
            ExprKind::Text(value) => Ok(Value::Text(value.clone())),
            ExprKind::Bool(value) => Ok(Value::Bool(*value)),
            ExprKind::Variable(name) => self.vars.get(name).cloned().ok_or_else(|| {
                self.error_at(expr.location, format!("unknown variable '{}'", name), None)
            }),
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
        if let Some(value) = self.call_builtin(name, args, location) {
            return value.map_err(|error| self.attach_location(error, location));
        }

        let function = match self.functions.get(name) {
            Some(function) => function.clone(),
            None => {
                return Err(self.error_at(location, format!("unknown function '{}'", name), None));
            }
        };

        if args.len() != function.params.len() {
            return Err(self.error_at(
                location,
                format!(
                    "Function '{}' expects {} arguments but received {}.",
                    name,
                    function.params.len(),
                    args.len()
                ),
                Some("Pass exactly the parameters declared by the function.".to_string()),
            ));
        }

        let saved_vars = self.vars.clone();

        for (index, param) in function.params.iter().enumerate() {
            let value = self.eval(&args[index])?;
            self.vars.insert(param.clone(), value);
        }

        let result = self.execute_block(&function.body)?.unwrap_or(Value::Null);
        self.vars = saved_vars;
        Ok(result)
    }

    fn call_builtin(
        &mut self,
        name: &str,
        args: &[Expr],
        location: SourceLocation,
    ) -> Option<Result<Value, RuntimeError>> {
        match name {
            "json_parse" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

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
                let value = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

                Some(value.map(|value| {
                    let json = value.to_json();
                    Value::Text(json.to_string())
                }))
            }
            "http_get" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

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
                let url = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

                let body = args
                    .get(1)
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

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
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

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
                let path = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

                let body = args
                    .get(1)
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

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
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

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

        Ok(canonical_parent.join(file_name))
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{AstRuntime, ExecutionPolicy};
    use crate::lexer::lex;
    use crate::parser::Parser;
    use crate::value::Value;

    fn parse(source: &str) -> Vec<crate::ast::Stmt> {
        let mut parser = Parser::new(lex(source));
        parser.parse().expect("parse succeeds")
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
}
