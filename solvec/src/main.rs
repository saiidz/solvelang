use std::collections::HashMap;
use std::env;
use std::fs;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        println!("Usage: solvec <file>");
        return;
    }

    let filename = &args[1];
    let content = fs::read_to_string(filename).expect("Failed to read file");

    run(&content);
}

fn run(code: &str) {
    let mut vars: HashMap<String, String> = HashMap::new();
    let normalized_code = code.replace("} else {", "}\nelse {");
    let lines: Vec<&str> = normalized_code.lines().collect();

    execute_block(&lines, 0, lines.len(), &mut vars);
}

fn execute_block(
    lines: &Vec<&str>,
    start: usize,
    end: usize,
    vars: &mut HashMap<String, String>,
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

        if line.starts_with("let ") {
            handle_let(line, vars);
        } else if line.starts_with("print(") {
            handle_print(line, vars);
        } else if line.starts_with("if ") {
            i = handle_if_else(lines, i, vars);
        } else if line.starts_with("else") {
            i = skip_block(lines, i);
        } else {
            println!("Error: unknown command '{}'", line);
        }

        i += 1;
    }
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
    lines: &Vec<&str>,
    start: usize,
    vars: &mut HashMap<String, String>,
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
        execute_block(lines, if_start, if_end, vars);

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
        execute_block(lines, else_start, else_end, vars);
        next_index = else_end;
    } else {
        next_index = if_end;
    }

    next_index
}

fn find_block_end(lines: &Vec<&str>, start: usize) -> usize {
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

fn skip_block(lines: &Vec<&str>, start: usize) -> usize {
    let block_start = start + 1;
    find_block_end(lines, block_start)
}

fn eval_condition(condition: &str, vars: &HashMap<String, String>) -> bool {
    for op in [">=", "<=", "==", "!=", ">", "<"] {
        if let Some(index) = condition.find(op) {
            let left = condition[..index].trim();
            let right = condition[index + op.len()..].trim();

            let left_value = eval(left, vars);
            let right_value = eval(right, vars);

            if let (Ok(left_num), Ok(right_num)) =
                (left_value.parse::<i32>(), right_value.parse::<i32>())
            {
                return match op {
                    ">" => left_num > right_num,
                    "<" => left_num < right_num,
                    ">=" => left_num >= right_num,
                    "<=" => left_num <= right_num,
                    "==" => left_num == right_num,
                    "!=" => left_num != right_num,
                    _ => false,
                };
            }

            return match op {
                "==" => left_value == right_value,
                "!=" => left_value != right_value,
                _ => false,
            };
        }
    }

    false
}

fn eval(expr: &str, vars: &HashMap<String, String>) -> String {
    let expr = expr.trim();

    if expr.starts_with('"') && expr.ends_with('"') {
        return expr.trim_matches('"').to_string();
    }

    if let Some((left, op, right)) = split_math(expr) {
        let left_value = eval(left, vars);
        let right_value = eval(right, vars);

        let left_number = left_value.parse::<i32>().unwrap_or(0);
        let right_number = right_value.parse::<i32>().unwrap_or(0);

        let result = match op {
            '+' => left_number + right_number,
            '-' => left_number - right_number,
            '*' => left_number * right_number,
            '/' => {
                if right_number == 0 {
                    println!("Error: cannot divide by zero");
                    return "0".to_string();
                }

                left_number / right_number
            }
            _ => 0,
        };

        return result.to_string();
    }

    if let Ok(number) = expr.parse::<i32>() {
        return number.to_string();
    }

    if let Some(value) = vars.get(expr) {
        return value.to_string();
    }

    expr.to_string()
}

fn split_math(expr: &str) -> Option<(&str, char, &str)> {
    for op in ['+', '-', '*', '/'] {
        if let Some(index) = expr.find(op) {
            if op == '-' && index == 0 {
                continue;
            }

            return Some((&expr[..index], op, &expr[index + 1..]));
        }
    }

    None
}