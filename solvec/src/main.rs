mod ast;
mod eval;
mod lexer;
mod parser;
mod runtime;
mod value;

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

    if args.iter().any(|arg| arg == "--tokens") {
        let tokens = lexer::lex(&content);
        println!("{:#?}", tokens);
        return;
    }

    if args.iter().any(|arg| arg == "--ast") {
        let tokens = lexer::lex(&content);
        let mut parser = parser::Parser::new(tokens);
        let ast = parser.parse();
        println!("{:#?}", ast);
        return;
    }

    runtime::run(&content);
}
