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
    if code.contains("print(") {
        let start = code.find("\"").unwrap() + 1;
        let end = code.rfind("\"").unwrap();
        let text = &code[start..end];
        println!("{}", text);
    } else {
        println!("Unknown command");
    }
}