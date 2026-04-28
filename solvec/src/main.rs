mod ast;
mod ast_runtime;
mod diagnostics;
mod eval;
mod lexer;
mod parser;
mod runtime;
mod value;

use std::env;
use std::fs;
use std::process;

#[derive(Debug, PartialEq)]
enum Command {
    Run,
    Tokens,
    Ast,
    Legacy,
    Help,
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    let (command, filename) = match parse_args(&args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("Error: {}", message);
            print_usage();
            process::exit(1);
        }
    };

    if command == Command::Help {
        print_usage();
        return;
    }

    let filename = match filename {
        Some(filename) => filename,
        None => {
            eprintln!("Error: missing SolveLang file");
            print_usage();
            process::exit(1);
        }
    };

    let content = fs::read_to_string(&filename).unwrap_or_else(|error| {
        eprintln!("Error: failed to read '{}': {}", filename, error);
        process::exit(1);
    });

    if let Err(diagnostics) = diagnostics::validate_source(&content) {
        let lines: Vec<&str> = content.lines().collect();

        for diagnostic in diagnostics {
            let source_line = lines.get(diagnostic.line.saturating_sub(1)).copied().unwrap_or("");
            eprintln!("{}", diagnostic.format(source_line));
            eprintln!();
        }

        process::exit(1);
    }

    run_command(command, &content);
}

fn parse_args(args: &[String]) -> Result<(Command, Option<String>), String> {
    if args.is_empty() {
        return Ok((Command::Help, None));
    }

    match args[0].as_str() {
        "help" | "--help" | "-h" => Ok((Command::Help, None)),
        "run" => Ok((Command::Run, args.get(1).cloned())),
        "tokens" => Ok((Command::Tokens, args.get(1).cloned())),
        "ast" => Ok((Command::Ast, args.get(1).cloned())),
        "legacy" => Ok((Command::Legacy, args.get(1).cloned())),
        file => {
            if args.iter().any(|arg| arg == "--tokens") {
                Ok((Command::Tokens, Some(file.to_string())))
            } else if args.iter().any(|arg| arg == "--ast") {
                Ok((Command::Ast, Some(file.to_string())))
            } else if args.iter().any(|arg| arg == "--legacy") {
                Ok((Command::Legacy, Some(file.to_string())))
            } else if file.starts_with('-') {
                Err(format!("unknown option '{}'", file))
            } else {
                Ok((Command::Run, Some(file.to_string())))
            }
        }
    }
}

fn run_command(command: Command, content: &str) {
    match command {
        Command::Run => run_ast_runtime(content),
        Command::Tokens => print_tokens(content),
        Command::Ast => print_ast(content),
        Command::Legacy => runtime::run(content),
        Command::Help => print_usage(),
    }
}

fn print_tokens(content: &str) {
    let tokens = lexer::lex(content);
    println!("{:#?}", tokens);
}

fn print_ast(content: &str) {
    let ast = parse_source(content);
    println!("{:#?}", ast);
}

fn run_ast_runtime(content: &str) {
    let ast = parse_source(content);
    let mut ast_runtime = ast_runtime::AstRuntime::new();
    ast_runtime.run(&ast);
}

fn parse_source(content: &str) -> Vec<ast::Stmt> {
    let tokens = lexer::lex(content);
    let mut parser = parser::Parser::new(tokens);
    parser.parse()
}

fn print_usage() {
    println!("SolveLang Compiler");
    println!();
    println!("Usage:");
    println!("  solvec run <file.solve>       Run with the AST runtime");
    println!("  solvec tokens <file.solve>    Print lexer tokens");
    println!("  solvec ast <file.solve>       Print parsed AST");
    println!("  solvec legacy <file.solve>    Run with the legacy runtime");
    println!();
    println!("Backwards-compatible flags:");
    println!("  solvec <file.solve> --tokens");
    println!("  solvec <file.solve> --ast");
    println!("  solvec <file.solve> --legacy");
}
