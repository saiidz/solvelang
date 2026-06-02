mod ai;
mod ast;
mod ast_runtime;
mod diagnostics;
mod eval;
mod lexer;
mod parser;
mod runtime;
mod value;

use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
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

    let content = load_source_with_imports(&filename).unwrap_or_else(|error| {
        eprintln!("Error: {}", error);
        process::exit(1);
    });

    if let Err(diagnostics) = diagnostics::validate_source(&content) {
        print_diagnostics(&content, diagnostics);
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
    if let Err(error) = ast_runtime.run(&ast) {
        eprintln!("{}", error);
        process::exit(1);
    }
}

fn parse_source(content: &str) -> Vec<ast::Stmt> {
    let tokens = lexer::lex(content);
    let mut parser = parser::Parser::new(tokens);
    match parser.parse() {
        Ok(ast) => ast,
        Err(diagnostics) => {
            print_diagnostics(content, diagnostics);
            process::exit(1);
        }
    }
}

fn print_diagnostics(content: &str, diagnostics: Vec<diagnostics::Diagnostic>) {
    let lines: Vec<&str> = content.lines().collect();

    for diagnostic in diagnostics {
        let source_line = lines
            .get(diagnostic.line.saturating_sub(1))
            .copied()
            .unwrap_or("");
        eprintln!("{}", diagnostic.format(source_line));
        eprintln!();
    }
}

fn load_source_with_imports(filename: &str) -> Result<String, String> {
    let path = PathBuf::from(filename);
    let mut visited = HashSet::new();
    load_file_recursive(&path, &mut visited)
}

fn load_file_recursive(path: &Path, visited: &mut HashSet<PathBuf>) -> Result<String, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("failed to resolve '{}': {}", path.display(), error))?;

    if !visited.insert(canonical.clone()) {
        return Err(format!(
            "circular import detected for '{}'",
            canonical.display()
        ));
    }

    let content = fs::read_to_string(&canonical)
        .map_err(|error| format!("failed to read '{}': {}", canonical.display(), error))?;

    let parent = canonical.parent().ok_or_else(|| {
        format!(
            "could not determine parent directory for '{}'",
            canonical.display()
        )
    })?;

    let mut output = String::new();

    for line in content.lines() {
        let trimmed = line.trim();

        if let Some(import_path) = parse_import_line(trimmed) {
            let imported_path = parent.join(import_path);
            let imported_content = load_file_recursive(&imported_path, visited)?;
            output.push_str(&imported_content);
            if !imported_content.ends_with('\n') {
                output.push('\n');
            }
        } else {
            output.push_str(line);
            output.push('\n');
        }
    }

    visited.remove(&canonical);
    Ok(output)
}

fn parse_import_line(line: &str) -> Option<&str> {
    if !line.starts_with("import ") {
        return None;
    }

    let rest = line["import ".len()..].trim();

    if rest.len() >= 2 && rest.starts_with('"') && rest.ends_with('"') {
        Some(&rest[1..rest.len() - 1])
    } else {
        None
    }
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
