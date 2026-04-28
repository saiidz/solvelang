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

    for line in code.lines() {
        let line = line.trim();

        if line.is_empty() || line.starts_with("//") {
            continue;
        }

        if line.starts_with("let ") {
            let parts: Vec<&str> = line.splitn(2, '=').collect();

            if parts.len() == 2 {
                let name = parts[0].replace("let", "").trim().to_string();
                let value = eval(parts[1].trim(), &vars);

                vars.insert(name, value);
            }
        } else if line.starts_with("print(") {
            let inside = line
                .trim_start_matches("print(")
                .trim_end_matches(")")
                .trim();

            let value = eval(inside, &vars);
            println!("{}", value);
        }
    }
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