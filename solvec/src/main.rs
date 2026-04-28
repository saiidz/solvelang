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

    run(content);
}

fn run(code: String) {
    let mut vars: HashMap<String, String> = HashMap::new();
    let lines: Vec<&str> = code.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        if line.is_empty() || line.starts_with("//") {
            i += 1;
            continue;
        }

        if line.starts_with("let ") {
            handle_let(line, &mut vars);
        } else if line.starts_with("print(") {
            handle_print(line, &vars);
        } else if line.starts_with("if ") {
            i = handle_if(&lines, i, &mut vars);
        } else {
            println!("Unknown command: {}", line);
        }

        i += 1;
    }
}

fn handle_let(line: &str, vars: &mut HashMap<String, String>) {
    let parts: Vec<&str> = line.splitn(2, '=').collect();

    if parts.len() == 2 {
        let name = parts[0].replace("let", "").trim().to_string();
        let value = eval(parts[1].trim(), vars);

        vars.insert(name, value);
    }
}

fn handle_print(line: &str, vars: &HashMap<String, String>) {
    let inside = line
        .trim_start_matches("print(")
        .trim_end_matches(")")
        .trim();

    let value = eval(inside, vars);
    println!("{}", value);
}

fn handle_if(lines: &Vec<&str>, start: usize, vars: &mut HashMap<String, String>) -> usize {
    let line = lines[start].trim();

    let condition = line
        .trim_start_matches("if")
        .trim()
        .trim_end_matches("{")
        .trim();

    let should_run = eval_condition(condition, vars);

    let mut i = start + 1;

    while i < lines.len() {
        let inner_line = lines[i].trim();

        if inner_line == "}" {
            break;
        }

        if should_run {
            if inner_line.starts_with("let ") {
                handle_let(inner_line, vars);
            } else if inner_line.starts_with("print(") {
                handle_print(inner_line, vars);
            }
        }

        i += 1;
    }

    i
}

fn eval_condition(condition: &str, vars: &HashMap<String, String>) -> bool {
    for op in [">=", "<=", "==", "!=", ">", "<"] {
        if let Some(index) = condition.find(op) {
            let left = condition[..index].trim();
            let right = condition[index + op.len()..].trim();

            let left_value = eval(left, vars).parse::<i32>().unwrap();
            let right_value = eval(right, vars).parse::<i32>().unwrap();

            return match op {
                ">" => left_value > right_value,
                "<" => left_value < right_value,
                ">=" => left_value >= right_value,
                "<=" => left_value <= right_value,
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
        return expr.replace('"', "");
    }

    if let Some((left, op, right)) = split_math(expr) {
        let left_value = eval(left, vars).parse::<i32>().unwrap();
        let right_value = eval(right, vars).parse::<i32>().unwrap();

        let result = match op {
            '+' => left_value + right_value,
            '-' => left_value - right_value,
            '*' => left_value * right_value,
            '/' => left_value / right_value,
            _ => 0,
        };

        return result.to_string();
    }

    if let Ok(number) = expr.parse::<i32>() {
        return number.to_string();
    }

    if vars.contains_key(expr) {
        return vars.get(expr).unwrap().to_string();
    }

    expr.to_string()
}

fn split_math(expr: &str) -> Option<(&str, char, &str)> {
    for op in ['+', '-', '*', '/'] {
        if let Some(index) = expr.find(op) {
            return Some((&expr[..index], op, &expr[index + 1..]));
        }
    }

    None
}
