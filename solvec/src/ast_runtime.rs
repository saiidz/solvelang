use std::collections::HashMap;

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
                println!("{}", self.ask_agent(agent, &self.eval(message)));
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
            Expr::Array(values) => Value::Array(values.iter().map(|value| self.eval(value)).collect()),
            Expr::Index(target, index) => {
                let target = self.eval(target);
                let index = self.eval(index).as_number().unwrap_or(0) as usize;

                match target {
                    Value::Array(values) => values.get(index).cloned().unwrap_or(Value::Null),
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
            BinaryOp::Add => Value::Number(left.as_number().unwrap_or(0) + right.as_number().unwrap_or(0)),
            BinaryOp::Subtract => Value::Number(left.as_number().unwrap_or(0) - right.as_number().unwrap_or(0)),
            BinaryOp::Multiply => Value::Number(left.as_number().unwrap_or(0) * right.as_number().unwrap_or(0)),
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
            BinaryOp::Greater => Value::Bool(left.as_number().unwrap_or(0) > right.as_number().unwrap_or(0)),
            BinaryOp::GreaterEqual => Value::Bool(left.as_number().unwrap_or(0) >= right.as_number().unwrap_or(0)),
            BinaryOp::Less => Value::Bool(left.as_number().unwrap_or(0) < right.as_number().unwrap_or(0)),
            BinaryOp::LessEqual => Value::Bool(left.as_number().unwrap_or(0) <= right.as_number().unwrap_or(0)),
        }
    }

    fn call_function(&mut self, name: &str, args: &[Expr]) -> Value {
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
