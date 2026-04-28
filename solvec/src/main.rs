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
    let mut vars = HashMap::new();

    for line in code.lines() {
        let line = line.trim();

        // handle: let name = "value"
        if line.starts_with("let ") {
            let parts: Vec<&str> = line.split('=').collect();

            if parts.len() == 2 {
                let name = parts[0].replace("let", "").trim().to_string();
                let value = parts[1].trim().replace("\"", "");

                vars.insert(name, value);
            }
        }

        // handle: print(...)
        else if line.starts_with("print(") {
            let inside = line
                .trim_start_matches("print(")
                .trim_end_matches(")");

            // if it's a variable
            if vars.contains_key(inside) {
                println!("{}", vars.get(inside).unwrap());
            } else {
                // string literal
                println!("{}", inside.replace("\"", ""));
            }
        }
    }
}