use std::collections::{BTreeMap, HashMap};

use reqwest::blocking::Client;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};

use crate::ast::{BinaryOp, Expr, Stmt, UnaryOp};
use crate::value::Value;

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeError {
    message: String,
}

impl RuntimeError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "SolveLang Runtime Error: {}", self.message)
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

#[derive(Default)]
pub struct AstRuntime {
    vars: HashMap<String, Value>,
    functions: HashMap<String, Function>,
    agents: HashMap<String, Agent>,
}

impl AstRuntime {
    pub fn new() -> Self {
        Self::default()
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
            Stmt::Let { name, value } => {
                let value = self.eval(value)?;
                self.vars.insert(name.clone(), value);
                Ok(None)
            }
            Stmt::Assign { name, value } => {
                if !self.vars.contains_key(name) {
                    return Err(RuntimeError::new(format!("unknown variable '{}'", name)));
                }
                let value = self.eval(value)?;
                self.vars.insert(name.clone(), value);
                Ok(None)
            }
            Stmt::Print(expr) => {
                println!("{}", self.eval(expr)?);
                Ok(None)
            }
            Stmt::Return(expr) => Ok(Some(self.eval(expr)?)),
            Stmt::Function { name, params, body } => {
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
            } => {
                if self.eval(condition)?.is_truthy() {
                    self.execute_block(then_branch)
                } else {
                    self.execute_block(else_branch)
                }
            }
            Stmt::While { condition, body } => {
                let mut safety_counter = 0;

                while self.eval(condition)?.is_truthy() {
                    if let Some(value) = self.execute_block(body)? {
                        return Ok(Some(value));
                    }

                    safety_counter += 1;
                    if safety_counter > 10_000 {
                        return Err(RuntimeError::new("loop stopped after 10000 iterations"));
                    }
                }

                Ok(None)
            }
            Stmt::Agent {
                name,
                instruction,
                tools,
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
            Stmt::Ask { agent, message } => {
                let message_value = self.eval(message)?;
                println!("{}", self.ask_agent(agent, &message_value));
                Ok(None)
            }
            Stmt::Expr(expr) => {
                self.eval(expr)?;
                Ok(None)
            }
        }
    }

    fn eval(&mut self, expr: &Expr) -> Result<Value, RuntimeError> {
        match expr {
            Expr::Number(value) => Ok(Value::Number(*value)),
            Expr::Text(value) => Ok(Value::Text(value.clone())),
            Expr::Bool(value) => Ok(Value::Bool(*value)),
            Expr::Variable(name) => self
                .vars
                .get(name)
                .cloned()
                .ok_or_else(|| RuntimeError::new(format!("unknown variable '{}'", name))),
            Expr::Array(values) => {
                let mut result = Vec::new();
                for value in values {
                    result.push(self.eval(value)?);
                }
                Ok(Value::Array(result))
            }
            Expr::Object(entries) => {
                let mut result = BTreeMap::new();
                for (key, value_expr) in entries {
                    result.insert(key.clone(), self.eval(value_expr)?);
                }
                Ok(Value::Object(result))
            }
            Expr::Property(target, property) => {
                let target = self.eval(target)?;
                match target {
                    Value::Object(entries) => {
                        Ok(entries.get(property).cloned().unwrap_or(Value::Null))
                    }
                    _ => Ok(Value::Null),
                }
            }
            Expr::Index(target, index) => {
                let target = self.eval(target)?;
                let index_value = self.eval(index)?;

                match target {
                    Value::Array(values) => {
                        let index = index_value.as_number().unwrap_or(0) as usize;
                        Ok(values.get(index).cloned().unwrap_or(Value::Null))
                    }
                    Value::Object(entries) => match index_value {
                        Value::Text(key) => Ok(entries.get(&key).cloned().unwrap_or(Value::Null)),
                        _ => Ok(Value::Null),
                    },
                    _ => Ok(Value::Null),
                }
            }
            Expr::Unary { operator, expr } => {
                let value = self.eval(expr)?;
                Ok(self.eval_unary(operator, value))
            }
            Expr::Binary {
                left,
                operator,
                right,
            } => {
                let left = self.eval(left)?;
                let right = self.eval(right)?;
                self.eval_binary(left, operator, right)
            }
            Expr::Call { name, args } => self.call_function(name, args),
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
    ) -> Result<Value, RuntimeError> {
        match operator {
            BinaryOp::Add => Ok(Value::Number(
                left.as_number().unwrap_or(0) + right.as_number().unwrap_or(0),
            )),
            BinaryOp::Subtract => Ok(Value::Number(
                left.as_number().unwrap_or(0) - right.as_number().unwrap_or(0),
            )),
            BinaryOp::Multiply => Ok(Value::Number(
                left.as_number().unwrap_or(0) * right.as_number().unwrap_or(0),
            )),
            BinaryOp::Divide => {
                let right_number = right.as_number().unwrap_or(0);
                if right_number == 0 {
                    Err(RuntimeError::new("divide by zero"))
                } else {
                    Ok(Value::Number(left.as_number().unwrap_or(0) / right_number))
                }
            }
            BinaryOp::Join => Ok(Value::Text(format!("{}{}", left, right))),
            BinaryOp::And => Ok(Value::Bool(left.is_truthy() && right.is_truthy())),
            BinaryOp::Or => Ok(Value::Bool(left.is_truthy() || right.is_truthy())),
            BinaryOp::Equal => Ok(Value::Bool(left == right)),
            BinaryOp::NotEqual => Ok(Value::Bool(left != right)),
            BinaryOp::Greater => Ok(Value::Bool(
                left.as_number().unwrap_or(0) > right.as_number().unwrap_or(0),
            )),
            BinaryOp::GreaterEqual => Ok(Value::Bool(
                left.as_number().unwrap_or(0) >= right.as_number().unwrap_or(0),
            )),
            BinaryOp::Less => Ok(Value::Bool(
                left.as_number().unwrap_or(0) < right.as_number().unwrap_or(0),
            )),
            BinaryOp::LessEqual => Ok(Value::Bool(
                left.as_number().unwrap_or(0) <= right.as_number().unwrap_or(0),
            )),
        }
    }

    fn call_function(&mut self, name: &str, args: &[Expr]) -> Result<Value, RuntimeError> {
        if let Some(value) = self.call_builtin(name, args) {
            return value;
        }

        let function = match self.functions.get(name) {
            Some(function) => function.clone(),
            None => return Err(RuntimeError::new(format!("unknown function '{}'", name))),
        };

        let saved_vars = self.vars.clone();

        for (index, param) in function.params.iter().enumerate() {
            let value = match args.get(index) {
                Some(arg) => self.eval(arg)?,
                None => Value::Null,
            };
            self.vars.insert(param.clone(), value);
        }

        let result = self.execute_block(&function.body)?.unwrap_or(Value::Null);
        self.vars = saved_vars;
        Ok(result)
    }

    fn call_builtin(&mut self, name: &str, args: &[Expr]) -> Option<Result<Value, RuntimeError>> {
        match name {
            "json_parse" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

                match input {
                    Ok(Value::Text(text)) => match serde_json::from_str::<JsonValue>(&text) {
                        Ok(json) => Some(Ok(Self::json_to_value(json))),
                        Err(error) => {
                            Some(Err(RuntimeError::new(format!("invalid JSON: {}", error))))
                        }
                    },
                    Ok(_) => Some(Err(RuntimeError::new("json_parse expects a text value"))),
                    Err(error) => Some(Err(error)),
                }
            }
            "json_stringify" => {
                let value = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

                Some(value.map(|value| {
                    let json = Self::value_to_json(&value);
                    Value::Text(json.to_string())
                }))
            }
            "http_get" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

                match input {
                    Ok(Value::Text(url)) => Some(self.http_get(&url)),
                    Ok(_) => Some(Err(RuntimeError::new("http_get expects a text URL"))),
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
                        Some(self.http_post(&url, &body))
                    }
                    (Ok(Value::Text(_)), Ok(_)) => {
                        Some(Err(RuntimeError::new("http_post expects a text body")))
                    }
                    (Ok(_), Ok(_)) => Some(Err(RuntimeError::new("http_post expects a text URL"))),
                    (Err(error), _) | (_, Err(error)) => Some(Err(error)),
                }
            }
            "read_file" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Ok(Value::Null));

                match input {
                    Ok(Value::Text(path)) => Some(self.read_file(&path)),
                    Ok(_) => Some(Err(RuntimeError::new("read_file expects a text path"))),
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
                        Some(self.write_file(&path, &body))
                    }
                    (Ok(Value::Text(_)), Ok(_)) => {
                        Some(Err(RuntimeError::new("write_file expects a text body")))
                    }
                    (Ok(_), Ok(_)) => {
                        Some(Err(RuntimeError::new("write_file expects a text path")))
                    }
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
                        let value = std::env::var(&name).unwrap_or_default();
                        Some(Ok(Value::Text(value)))
                    }
                    Ok(_) => Some(Err(RuntimeError::new("env expects a text variable name"))),
                    Err(error) => Some(Err(error)),
                }
            }
            _ => None,
        }
    }

    fn http_get(&self, url: &str) -> Result<Value, RuntimeError> {
        let client = match Client::builder().build() {
            Ok(client) => client,
            Err(error) => {
                return Err(RuntimeError::new(format!(
                    "could not create HTTP client: {}",
                    error
                )));
            }
        };

        let response = match client.get(url).send() {
            Ok(response) => response,
            Err(error) => {
                return Err(RuntimeError::new(format!("http_get failed: {}", error)));
            }
        };

        let status = response.status().as_u16() as i32;
        let final_url = response.url().to_string();

        let mut headers = BTreeMap::new();
        for (name, value) in response.headers().iter() {
            headers.insert(
                name.to_string(),
                Value::Text(value.to_str().unwrap_or("").to_string()),
            );
        }

        let body = match response.text() {
            Ok(body) => body,
            Err(error) => {
                return Err(RuntimeError::new(format!(
                    "could not read HTTP response body: {}",
                    error
                )));
            }
        };

        let mut result = BTreeMap::new();
        result.insert("status".to_string(), Value::Number(status));
        result.insert("url".to_string(), Value::Text(final_url));
        result.insert("body".to_string(), Value::Text(body));
        result.insert("headers".to_string(), Value::Object(headers));

        Ok(Value::Object(result))
    }

    fn read_file(&self, path: &str) -> Result<Value, RuntimeError> {
        match std::fs::read_to_string(path) {
            Ok(content) => Ok(Value::Text(content)),
            Err(error) => Err(RuntimeError::new(format!("read_file failed: {}", error))),
        }
    }

    fn write_file(&self, path: &str, body: &str) -> Result<Value, RuntimeError> {
        match std::fs::write(path, body) {
            Ok(_) => Ok(Value::Bool(true)),
            Err(error) => Err(RuntimeError::new(format!("write_file failed: {}", error))),
        }
    }

    fn http_post(&self, url: &str, body: &str) -> Result<Value, RuntimeError> {
        let client = match Client::builder().build() {
            Ok(client) => client,
            Err(error) => {
                return Err(RuntimeError::new(format!(
                    "could not create HTTP client: {}",
                    error
                )));
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
                return Err(RuntimeError::new(format!("http_post failed: {}", error)));
            }
        };

        let status = response.status().as_u16() as i32;
        let final_url = response.url().to_string();

        let mut headers = BTreeMap::new();
        for (name, value) in response.headers().iter() {
            headers.insert(
                name.to_string(),
                Value::Text(value.to_str().unwrap_or("").to_string()),
            );
        }

        let body = match response.text() {
            Ok(body) => body,
            Err(error) => {
                return Err(RuntimeError::new(format!(
                    "could not read HTTP response body: {}",
                    error
                )));
            }
        };

        let mut result = BTreeMap::new();
        result.insert("status".to_string(), Value::Number(status));
        result.insert("url".to_string(), Value::Text(final_url));
        result.insert("body".to_string(), Value::Text(body));
        result.insert("headers".to_string(), Value::Object(headers));

        Ok(Value::Object(result))
    }

    fn json_to_value(json: JsonValue) -> Value {
        match json {
            JsonValue::Null => Value::Null,
            JsonValue::Bool(value) => Value::Bool(value),
            JsonValue::Number(value) => Value::Number(value.as_i64().unwrap_or(0) as i32),
            JsonValue::String(value) => Value::Text(value),
            JsonValue::Array(values) => {
                Value::Array(values.into_iter().map(Self::json_to_value).collect())
            }
            JsonValue::Object(entries) => {
                let mut map = BTreeMap::new();
                for (key, value) in entries {
                    map.insert(key, Self::json_to_value(value));
                }
                Value::Object(map)
            }
        }
    }

    fn value_to_json(value: &Value) -> JsonValue {
        match value {
            Value::Null => JsonValue::Null,
            Value::Bool(value) => JsonValue::Bool(*value),
            Value::Number(value) => JsonValue::Number(JsonNumber::from(*value)),
            Value::Text(value) => JsonValue::String(value.clone()),
            Value::Array(values) => {
                JsonValue::Array(values.iter().map(Self::value_to_json).collect())
            }
            Value::Object(entries) => {
                let mut map = JsonMap::new();
                for (key, value) in entries {
                    map.insert(key.clone(), Self::value_to_json(value));
                }
                JsonValue::Object(map)
            }
        }
    }

    fn ask_agent(&self, name: &str, message: &Value) -> String {
        let agent = match self.agents.get(name) {
            Some(agent) => agent,
            None => return format!("Error: unknown agent '{}'", name),
        };

        let tools = if agent.tools.is_empty() {
            "none".to_string()
        } else {
            agent.tools.join(", ")
        };

        format!(
            "[{} AI Agent]\nInstruction: {}\nTools: {}\nUser: {}\nResponse: This is a local SolveLang agent prototype. Connect an AI provider later to generate live answers.",
            name, agent.instruction, tools, message
        )
    }
}

#[cfg(test)]
mod tests {
    use super::AstRuntime;
    use crate::lexer::lex;
    use crate::parser::Parser;

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
let parsed = json_parse("{\"name\":\"SolveLang\",\"count\":2}")
let encoded = json_stringify({ name: parsed.name, count: count })
if user.active {
    let result = picked + parsed.count
} else {
    let result = 0
}
"#,
        );
        let mut runtime = AstRuntime::new();

        runtime.run(&statements).expect("runtime succeeds");
    }

    #[test]
    fn reports_unknown_variables_and_divide_by_zero() {
        let mut runtime = AstRuntime::new();
        let unknown = runtime
            .run(&parse("print(missing)\n"))
            .expect_err("unknown variable should fail");
        assert!(unknown.to_string().contains("unknown variable 'missing'"));

        let mut runtime = AstRuntime::new();
        let divide = runtime
            .run(&parse("print(10 / 0)\n"))
            .expect_err("divide by zero should fail");
        assert!(divide.to_string().contains("divide by zero"));
    }
}
