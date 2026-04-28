use std::collections::HashMap;

use crate::eval::{eval, eval_condition};

#[derive(Clone)]
struct Function {
    param: String,
    body: Vec<String>,
}

pub fn run(code: &str) {
    let normalized_code = code.replace("} else {", "}\nelse {");
    let lines: Vec<String> = normalized_code
        .lines()
        .map(|line| line.to_string())
        .collect();

    let mut vars: HashMap<String, String> = HashMap::new();
    let mut functions: HashMap<String, Function> = HashMap::new();

    execute_block(&lines, 0, lines.len(), &mut vars, &mut functions);
}

fn execute_block(
    lines: &Vec<String>,
    start: usize,
    end: usize,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
) {
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

        if line.starts_with("fn ") {
            i = handle_function_definition(lines, i, functions);
        } else if line.starts_with("let ") {
            handle_let(line, vars);
        } else if line.starts_with("print(") {
            handle_print(line, vars);
        } else if line.starts_with("if ") {
            i = handle_if_else(lines, i, vars, functions);
        } else if line.starts_with("while ") {
            i = handle_while(lines, i, vars, functions);
        } else if line.starts_with("else") {
            i = skip_block(lines, i);
        } else if is_function_call(line) {
            handle_function_call(line, vars, functions);
        } else {
            println!("Error: unknown command '{}'", line);
        }

        i += 1;
    }
}

fn handle_while(
    lines: &Vec<String>,
    start: usize,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
) -> usize {
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
        execute_block(lines, body_start, body_end, vars, functions);

        safety_counter += 1;

        if safety_counter > 10_000 {
            println!("Error: loop stopped after 10000 iterations");
            break;
        }
    }

    body_end
}

fn handle_function_definition(
    lines: &Vec<String>,
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
    let param = header[open_paren + 1..close_paren].trim().to_string();

    let body_start = start + 1;
    let body_end = find_block_end(lines, body_start);

    let mut body = Vec::new();

    for line in &lines[body_start..body_end] {
        body.push(line.to_string());
    }

    functions.insert(name, Function { param, body });

    body_end
}

fn handle_function_call(
    line: &str,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
) {
    let open_paren = line.find('(').unwrap_or(0);
    let close_paren = line.rfind(')').unwrap_or(line.len());

    let name = line[..open_paren].trim();
    let argument = line[open_paren + 1..close_paren].trim();

    let function = match functions.get(name) {
        Some(function) => function.clone(),
        None => {
            println!("Error: unknown function '{}'", name);
            return;
        }
    };

    let argument_value = eval(argument, vars);
    let mut local_vars = vars.clone();

    if !function.param.is_empty() {
        local_vars.insert(function.param.clone(), argument_value);
    }

    execute_block(
        &function.body,
        0,
        function.body.len(),
        &mut local_vars,
        functions,
    );
}

fn is_function_call(line: &str) -> bool {
    line.contains('(') && line.ends_with(')')
}

fn handle_let(line: &str, vars: &mut HashMap<String, String>) {
    let parts: Vec<&str> = line.splitn(2, '=').collect();

    if parts.len() != 2 {
        println!("Error: expected syntax like let name = value");
        return;
    }

    let name = parts[0].replace("let", "").trim().to_string();
    let value = eval(parts[1].trim(), vars);

    vars.insert(name, value);
}

fn handle_print(line: &str, vars: &HashMap<String, String>) {
    let inside = line
        .trim_start_matches("print(")
        .trim_end_matches(")")
        .trim();

    let value = eval(inside, vars);
    println!("{}", value);
}

fn handle_if_else(
    lines: &Vec<String>,
    start: usize,
    vars: &mut HashMap<String, String>,
    functions: &mut HashMap<String, Function>,
) -> usize {
    let line = lines[start].trim();

    let condition = line
        .trim_start_matches("if")
        .trim()
        .trim_end_matches("{")
        .trim();

    let condition_is_true = eval_condition(condition, vars);
    let if_start = start + 1;
    let if_end = find_block_end(lines, if_start);

    let mut next_index = if_end + 1;
    let has_else = next_index < lines.len() && lines[next_index].trim().starts_with("else");

    if condition_is_true {
        execute_block(lines, if_start, if_end, vars, functions);

        if has_else {
            let else_start = next_index + 1;
            let else_end = find_block_end(lines, else_start);
            next_index = else_end;
        } else {
            next_index = if_end;
        }
    } else if has_else {
        let else_start = next_index + 1;
        let else_end = find_block_end(lines, else_start);
        execute_block(lines, else_start, else_end, vars, functions);
        next_index = else_end;
    } else {
        next_index = if_end;
    }

    next_index
}

fn find_block_end(lines: &Vec<String>, start: usize) -> usize {
    let mut depth = 0;

    for i in start..lines.len() {
        let line = lines[i].trim();

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

fn skip_block(lines: &Vec<String>, start: usize) -> usize {
    let block_start = start + 1;
    find_block_end(lines, block_start)
}
