use std::collections::HashMap;

use crate::eval::{eval, eval_condition, split_args};

#[derive(Clone)]
struct Function {
    params: Vec<String>,
    body: Vec<String>,
}

#[derive(Clone)]
struct Agent {
    instruction: String,
    tools: Vec<String>,
}

pub fn run(code: &str) {
    let normalized_code = code.replace("} else {", "}\nelse {");
    let lines: Vec<String> = normalized_code
        .lines()
        .map(|line| line.to_string())
        .collect();

    let mut vars: HashMap<String, String> = HashMap::new();
    let mut functions: HashMap<String, Function> = HashMap::new();
    let mut agents: HashMap<String, Agent> = HashMap::new();

    execute_block(
        &lines,
        0,
        lines.len(),
        &mut vars,
        &mut functions,
        &mut agents,
    );
}

fn execute_block(
    lines: &[String],
    start: usize,
    end: usize,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) -> Option<String> {
    let mut i = start;

    while i < end {
        let line = lines[i].trim();

        if line.is_empty() || line.starts_with("//") {
            i += 1;
            continue;
        }

        if line == "}" {
            i += 1;
            continue;
        }

        if line.starts_with("agent ") {
            i = handle_agent_definition(lines, i, agents);
        } else if line.starts_with("fn ") {
            i = handle_function_definition(lines, i, functions);
        } else if line.starts_with("return ") {
            return Some(eval_value(
                line.trim_start_matches("return").trim(),
                vars,
                functions,
                agents,
            ));
        } else if line.starts_with("let ") {
            handle_let(line, vars, functions, agents);
        } else if line.starts_with("print(") {
            handle_print(line, vars, functions, agents);
        } else if line.starts_with("ask ") {
            handle_ask_statement(line, vars, functions, agents);
        } else if line.starts_with("if ") {
            if let Some(value) = handle_if_else(lines, i, vars, functions, agents) {
                return Some(value);
            }
            i = skip_if_else(lines, i);
        } else if line.starts_with("while ") {
            if let Some(value) = handle_while(lines, i, vars, functions, agents) {
                return Some(value);
            }
            i = skip_block(lines, i);
        } else if line.starts_with("else") {
            i = skip_block(lines, i);
        } else if is_function_call(line) {
            eval_value(line, vars, functions, agents);
        } else {
            println!("Error: unknown command '{}'", line);
        }

        i += 1;
    }

    None
}

fn handle_agent_definition(
    lines: &[String],
    start: usize,
    agents: &mut HashMap<String, Agent>,
) -> usize {
    let line = lines[start].trim();
    let name = line
        .trim_start_matches("agent")
        .trim()
        .trim_end_matches("{")
        .trim()
        .to_string();

    let body_start = start + 1;
    let body_end = find_block_end(lines, body_start);
    let mut instruction = String::new();
    let mut tools = Vec::new();

    for item in &lines[body_start..body_end] {
        let item = item.trim();

        if item.starts_with("instruction ") {
            instruction = eval(
                item.trim_start_matches("instruction").trim(),
                &HashMap::new(),
            );
        } else if item.starts_with("tool ") {
            tools.push(item.trim_start_matches("tool").trim().to_string());
        }
    }

    agents.insert(name, Agent { instruction, tools });
    body_end
}

fn handle_ask_statement(
    line: &str,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) {
    let answer = eval_ask(line, vars, functions, agents);
    println!("{}", answer);
}

fn eval_ask(
    expr: &str,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) -> String {
    let expr = expr.trim_start_matches("ask").trim();
    let open_paren = expr.find('(').unwrap_or(0);
    let close_paren = expr.rfind(')').unwrap_or(expr.len());

    let name = expr[..open_paren].trim();
    let message_expr = expr[open_paren + 1..close_paren].trim();
    let message = eval_value(message_expr, vars, functions, agents);

    let agent = match agents.get(name) {
        Some(agent) => agent.clone(),
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

fn handle_while(
    lines: &[String],
    start: usize,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) -> Option<String> {
    let line = lines[start].trim();

    let condition = line
        .trim_start_matches("while")
        .trim()
        .trim_end_matches("{")
        .trim();

    let body_start = start + 1;
    let body_end = find_block_end(lines, body_start);
    let mut safety_counter = 0;

    while eval_condition(condition, vars) {
        if let Some(value) = execute_block(lines, body_start, body_end, vars, functions, agents) {
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

fn handle_function_definition(
    lines: &[String],
    start: usize,
    functions: &mut HashMap<String, Function>,
) -> usize {
    let line = lines[start].trim();

    let header = line
        .trim_start_matches("fn")
        .trim()
        .trim_end_matches("{")
        .trim();

    let open_paren = header.find('(').unwrap_or(0);
    let close_paren = header.find(')').unwrap_or(header.len());

    let name = header[..open_paren].trim().to_string();
    let params = split_args(&header[open_paren + 1..close_paren])
        .into_iter()
        .filter(|param| !param.is_empty())
        .collect();

    let body_start = start + 1;
    let body_end = find_block_end(lines, body_start);
    let body = lines[body_start..body_end].to_vec();

    functions.insert(name, Function { params, body });

    body_end
}

fn eval_value(
    expr: &str,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) -> String {
    let expr = expr.trim();

    if expr.starts_with("ask ") {
        return eval_ask(expr, vars, functions, agents);
    }

    if is_function_call(expr) {
        return handle_function_call(expr, vars, functions, agents);
    }

    eval(expr, vars)
}

fn handle_function_call(
    line: &str,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) -> String {
    let open_paren = line.find('(').unwrap_or(0);
    let close_paren = line.rfind(')').unwrap_or(line.len());

    let name = line[..open_paren].trim();
    let argument_text = line[open_paren + 1..close_paren].trim();

    let function = match functions.get(name) {
        Some(function) => function.clone(),
        None => {
            println!("Error: unknown function '{}'", name);
            return String::new();
        }
    };

    let args = split_args(argument_text);
    let mut local_vars = vars.clone();

    for (index, param) in function.params.iter().enumerate() {
        let arg_value = args
            .get(index)
            .map(|arg| eval_value(arg, vars, functions, agents))
            .unwrap_or_default();

        local_vars.insert(param.clone(), arg_value);
    }

    execute_block(
        &function.body,
        0,
        function.body.len(),
        &mut local_vars,
        functions,
        agents,
    )
    .unwrap_or_default()
}

fn is_function_call(line: &str) -> bool {
    line.contains('(')
        && line.ends_with(')')
        && !line.starts_with("print(")
        && !line.starts_with("ask ")
}

fn handle_let(
    line: &str,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) {
    let parts: Vec<&str> = line.splitn(2, '=').collect();

    if parts.len() != 2 {
        println!("Error: expected syntax like let name = value");
        return;
    }

    let name = parts[0].replace("let", "").trim().to_string();
    let value = eval_value(parts[1].trim(), vars, functions, agents);

    vars.insert(name, value);
}

fn handle_print(
    line: &str,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) {
    let inside = line
        .strip_prefix("print(")
        .and_then(|value| value.strip_suffix(')'))
        .unwrap_or("")
        .trim();

    let value = eval_value(inside, vars, functions, agents);
    println!("{}", value);
}

fn handle_if_else(
    lines: &[String],
    start: usize,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
    agents: &mut HashMap<String, Agent>,
) -> Option<String> {
    let line = lines[start].trim();

    let condition = line
        .trim_start_matches("if")
        .trim()
        .trim_end_matches("{")
        .trim();

    let condition_is_true = eval_condition(condition, vars);
    let if_start = start + 1;
    let if_end = find_block_end(lines, if_start);

    let else_index = if_end + 1;
    let has_else = else_index < lines.len() && lines[else_index].trim().starts_with("else");

    if condition_is_true {
        return execute_block(lines, if_start, if_end, vars, functions, agents);
    }

    if has_else {
        let else_start = else_index + 1;
        let else_end = find_block_end(lines, else_start);
        return execute_block(lines, else_start, else_end, vars, functions, agents);
    }

    None
}

fn skip_if_else(lines: &[String], start: usize) -> usize {
    let if_start = start + 1;
    let if_end = find_block_end(lines, if_start);
    let else_index = if_end + 1;

    if else_index < lines.len() && lines[else_index].trim().starts_with("else") {
        return skip_block(lines, else_index);
    }

    if_end
}

fn find_block_end(lines: &[String], start: usize) -> usize {
    let mut depth = 0;

    for (i, item) in lines.iter().enumerate().skip(start) {
        let line = item.trim();

        if line.ends_with("{") {
            depth += 1;
        }

        if line == "}" {
            if depth == 0 {
                return i;
            }

            depth -= 1;
        }
    }

    lines.len()
}

fn skip_block(lines: &[String], start: usize) -> usize {
    let block_start = start + 1;
    find_block_end(lines, block_start)
}
