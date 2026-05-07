use std::collections::{BTreeMap, HashMap};

use reqwest::blocking::Client;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};

use crate::ast::{BinaryOp, Expr, Stmt};
use crate::value::Value;

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

    pub fn run(&mut self, statements: &[Stmt]) {
        self.execute_block(statements);
    }

    fn execute_block(&mut self, statements: &[Stmt]) -> Option<Value> {
        for statement in statements {
            if let Some(value) = self.execute(statement) {
                return Some(value);
            }
        }

        None
    }

    fn execute(&mut self, statement: &Stmt) -> Option<Value> {
        match statement {
            Stmt::Let { name, value } => {
                let value = self.eval(value);
                self.vars.insert(name.clone(), value);
                None
            }
            Stmt::Print(expr) => {
                println!("{}", self.eval(expr));
                None
            }
            Stmt::Return(expr) => Some(self.eval(expr)),
            Stmt::Function { name, params, body } => {
                self.functions.insert(
                    name.clone(),
                    Function {
                        params: params.clone(),
                        body: body.clone(),
                    },
                );
                None
            }
            Stmt::If {
                condition,
                then_branch,
                else_branch,
            } => {
                if self.eval(condition).is_truthy() {
                    self.execute_block(then_branch)
                } else {
                    self.execute_block(else_branch)
                }
            }
            Stmt::While { condition, body } => {
                let mut safety_counter = 0;

                while self.eval(condition).is_truthy() {
                    if let Some(value) = self.execute_block(body) {
                        return Some(value);
                    }

                    safety_counter += 1;
                    if safety_counter > 10_000 {
                        println!("Error: loop stopped after 10000 iterations");
                        break;
                    }
                }

                None
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
                None
            }
            Stmt::Ask { agent, message } => {
                let message_value = self.eval(message);
                println!("{}", self.ask_agent(agent, &message_value));
                None
            }
            Stmt::Expr(expr) => {
                self.eval(expr);
                None
            }
        }
    }

    fn eval(&mut self, expr: &Expr) -> Value {
        match expr {
            Expr::Number(value) => Value::Number(*value),
            Expr::Text(value) => Value::Text(value.clone()),
            Expr::Bool(value) => Value::Bool(*value),
            Expr::Variable(name) => self.vars.get(name).cloned().unwrap_or(Value::Null),
            Expr::Array(values) => {
                Value::Array(values.iter().map(|value| self.eval(value)).collect())
            }
            Expr::Object(entries) => {
                let mut result = BTreeMap::new();
                for (key, value_expr) in entries {
                    result.insert(key.clone(), self.eval(value_expr));
                }
                Value::Object(result)
            }
            Expr::Property(target, property) => {
                let target = self.eval(target);
                match target {
                    Value::Object(entries) => entries.get(property).cloned().unwrap_or(Value::Null),
                    _ => Value::Null,
                }
            }
            Expr::Index(target, index) => {
                let target = self.eval(target);
                let index_value = self.eval(index);

                match target {
                    Value::Array(values) => {
                        let index = index_value.as_number().unwrap_or(0) as usize;
                        values.get(index).cloned().unwrap_or(Value::Null)
                    }
                    Value::Object(entries) => match index_value {
                        Value::Text(key) => entries.get(&key).cloned().unwrap_or(Value::Null),
                        _ => Value::Null,
                    },
                    _ => Value::Null,
                }
            }
            Expr::Binary {
                left,
                operator,
                right,
            } => {
                let left = self.eval(left);
                let right = self.eval(right);
                self.eval_binary(left, operator, right)
            }
            Expr::Call { name, args } => self.call_function(name, args),
        }
    }

    fn eval_binary(&self, left: Value, operator: &BinaryOp, right: Value) -> Value {
        match operator {
            BinaryOp::Add => {
                Value::Number(left.as_number().unwrap_or(0) + right.as_number().unwrap_or(0))
            }
            BinaryOp::Subtract => {
                Value::Number(left.as_number().unwrap_or(0) - right.as_number().unwrap_or(0))
            }
            BinaryOp::Multiply => {
                Value::Number(left.as_number().unwrap_or(0) * right.as_number().unwrap_or(0))
            }
            BinaryOp::Divide => {
                let right_number = right.as_number().unwrap_or(0);
                if right_number == 0 {
                    println!("Error: cannot divide by zero");
                    Value::Null
                } else {
                    Value::Number(left.as_number().unwrap_or(0) / right_number)
                }
            }
            BinaryOp::Join => Value::Text(format!("{}{}", left, right)),
            BinaryOp::Equal => Value::Bool(left == right),
            BinaryOp::NotEqual => Value::Bool(left != right),
            BinaryOp::Greater => {
                Value::Bool(left.as_number().unwrap_or(0) > right.as_number().unwrap_or(0))
            }
            BinaryOp::GreaterEqual => {
                Value::Bool(left.as_number().unwrap_or(0) >= right.as_number().unwrap_or(0))
            }
            BinaryOp::Less => {
                Value::Bool(left.as_number().unwrap_or(0) < right.as_number().unwrap_or(0))
            }
            BinaryOp::LessEqual => {
                Value::Bool(left.as_number().unwrap_or(0) <= right.as_number().unwrap_or(0))
            }
        }
    }

    fn call_function(&mut self, name: &str, args: &[Expr]) -> Value {
        if let Some(value) = self.call_builtin(name, args) {
            return value;
        }

        let function = match self.functions.get(name) {
            Some(function) => function.clone(),
            None => {
                println!("Error: unknown function '{}'", name);
                return Value::Null;
            }
        };

        let saved_vars = self.vars.clone();

        for (index, param) in function.params.iter().enumerate() {
            let value = args.get(index).map(|arg| self.eval(arg)).unwrap_or(Value::Null);
            self.vars.insert(param.clone(), value);
        }

        let result = self.execute_block(&function.body).unwrap_or(Value::Null);
        self.vars = saved_vars;
        result
    }

    fn call_builtin(&mut self, name: &str, args: &[Expr]) -> Option<Value> {
        match name {
            "json_parse" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                match input {
                    Value::Text(text) => match serde_json::from_str::<JsonValue>(&text) {
                        Ok(json) => Some(Self::json_to_value(json)),
                        Err(error) => {
                            println!("Error: invalid JSON: {}", error);
                            Some(Value::Null)
                        }
                    },
                    _ => {
                        println!("Error: json_parse expects a text value");
                        Some(Value::Null)
                    }
                }
            }
            "json_stringify" => {
                let value = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                let json = Self::value_to_json(&value);
                Some(Value::Text(json.to_string()))
            }
            "http_get" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                match input {
                    Value::Text(url) => Some(self.http_get(&url)),
                    _ => {
                        println!("Error: http_get expects a text URL");
                        Some(Value::Null)
                    }
                }
            }
            "http_post" => {
                let url = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                let body = args
                    .get(1)
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                match (url, body) {
                    (Value::Text(url), Value::Text(body)) => Some(self.http_post(&url, &body)),
                    (Value::Text(_), _) => {
                        println!("Error: http_post expects a text body");
                        Some(Value::Null)
                    }
                    _ => {
                        println!("Error: http_post expects a text URL");
                        Some(Value::Null)
                    }
                }
            }
            "read_file" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                match input {
                    Value::Text(path) => Some(self.read_file(&path)),
                    _ => {
                        println!("Error: read_file expects a text path");
                        Some(Value::Null)
                    }
                }
            }
            "write_file" => {
                let path = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                let body = args
                    .get(1)
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                match (path, body) {
                    (Value::Text(path), Value::Text(body)) => Some(self.write_file(&path, &body)),
                    (Value::Text(_), _) => {
                        println!("Error: write_file expects a text body");
                        Some(Value::Null)
                    }
                    _ => {
                        println!("Error: write_file expects a text path");
                        Some(Value::Null)
                    }
                }
            }
            "env" => {
                let input = args
                    .first()
                    .map(|arg| self.eval(arg))
                    .unwrap_or(Value::Null);

                match input {
                    Value::Text(name) => {
                        let value = std::env::var(&name).unwrap_or_default();
                        Some(Value::Text(value))
                    }
                    _ => {
                        println!("Error: env expects a text variable name");
                        Some(Value::Null)
                    }
                }
            }
            _ => None,
        }
    }

    fn http_get(&self, url: &str) -> Value {
        let client = match Client::builder().build() {
            Ok(client) => client,
            Err(error) => {
                println!("Error: could not create HTTP client: {}", error);
                return Value::Null;
            }
        };

        let response = match client.get(url).send() {
            Ok(response) => response,
            Err(error) => {
                println!("Error: http_get failed: {}", error);
                return Value::Null;
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
                println!("Error: could not read HTTP response body: {}", error);
                return Value::Null;
            }
        };

        let mut result = BTreeMap::new();
        result.insert("status".to_string(), Value::Number(status));
        result.insert("url".to_string(), Value::Text(final_url));
        result.insert("body".to_string(), Value::Text(body));
        result.insert("headers".to_string(), Value::Object(headers));

        Value::Object(result)
    }

    fn read_file(&self, path: &str) -> Value {
        match std::fs::read_to_string(path) {
            Ok(content) => Value::Text(content),
            Err(error) => {
                println!("Error: read_file failed: {}", error);
                Value::Null
            }
        }
    }

    fn write_file(&self, path: &str, body: &str) -> Value {
        match std::fs::write(path, body) {
            Ok(_) => Value::Bool(true),
            Err(error) => {
                println!("Error: write_file failed: {}", error);
                Value::Null
            }
        }
    }


    fn http_post(&self, url: &str, body: &str) -> Value {
        let client = match Client::builder().build() {
            Ok(client) => client,
            Err(error) => {
                println!("Error: could not create HTTP client: {}", error);
                return Value::Null;
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
                println!("Error: http_post failed: {}", error);
                return Value::Null;
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
                println!("Error: could not read HTTP response body: {}", error);
                return Value::Null;
            }
        };

        let mut result = BTreeMap::new();
        result.insert("status".to_string(), Value::Number(status));
        result.insert("url".to_string(), Value::Text(final_url));
        result.insert("body".to_string(), Value::Text(body));
        result.insert("headers".to_string(), Value::Object(headers));

        Value::Object(result)
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
