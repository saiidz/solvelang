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

        if line.is_empty() {
            continue;
        }

        if line.starts_with("let ") {
            let parts: Vec<&str> = line.split('=').collect();

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

    if expr.contains('+') {
        let parts: Vec<&str> = expr.split('+').collect();
        let mut total = 0;

        for part in parts {
            let value = eval(part.trim(), vars);
            total += value.parse::<i32>().unwrap();
        }

        return total.to_string();
    }

    if expr.starts_with('"') && expr.ends_with('"') {
        return expr.replace('"', "");
    }

    if let Ok(number) = expr.parse::<i32>() {
        return number.to_string();
    }

    if vars.contains_key(expr) {
        return vars.get(expr).unwrap().to_string();
    }

    expr.to_string()
}