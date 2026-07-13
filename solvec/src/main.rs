mod ai;
mod ast;
mod ast_runtime;
mod diagnostics;
mod lexer;
mod parser;
mod value;

use ast_runtime::ExecutionPolicy;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::Duration;

#[derive(Debug, PartialEq)]
enum Command {
    Run(RunOptions),
    Validate,
    Tokens,
    Ast,
    Help,
}

#[derive(Clone, Debug, PartialEq)]
struct RunOptions {
    safe: bool,
    allow_network: bool,
    allow_file_read: bool,
    allow_file_write: bool,
    allow_env: bool,
    allowed_roots: Vec<PathBuf>,
    http_connect_timeout_ms: u64,
    http_request_timeout_ms: u64,
    http_max_body_bytes: usize,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            safe: false,
            allow_network: false,
            allow_file_read: false,
            allow_file_write: false,
            allow_env: false,
            allowed_roots: Vec::new(),
            http_connect_timeout_ms: ExecutionPolicy::DEFAULT_HTTP_CONNECT_TIMEOUT.as_millis()
                as u64,
            http_request_timeout_ms: ExecutionPolicy::DEFAULT_HTTP_REQUEST_TIMEOUT.as_millis()
                as u64,
            http_max_body_bytes: ExecutionPolicy::DEFAULT_HTTP_MAX_BODY_BYTES,
        }
    }
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

    if matches!(command, Command::Help) {
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

    run_command(command, &content, &filename);
}

fn parse_args(args: &[String]) -> Result<(Command, Option<String>), String> {
    if args.is_empty() {
        return Ok((Command::Help, None));
    }

    match args[0].as_str() {
        "help" | "--help" | "-h" => Ok((Command::Help, None)),
        "run" => parse_run_args(&args[1..]),
        "validate" => Ok((Command::Validate, args.get(1).cloned())),
        "tokens" => Ok((Command::Tokens, args.get(1).cloned())),
        "ast" => Ok((Command::Ast, args.get(1).cloned())),
        "legacy" => Err(
            "legacy runtime has been removed from the public CLI; use 'solvec run <file.solve>'"
                .to_string(),
        ),
        file => {
            if args.iter().any(|arg| arg == "--tokens") {
                Ok((Command::Tokens, Some(file.to_string())))
            } else if args.iter().any(|arg| arg == "--ast") {
                Ok((Command::Ast, Some(file.to_string())))
            } else if args.iter().any(|arg| arg == "--legacy") {
                Err(
                    "--legacy has been removed from the public CLI; use 'solvec run <file.solve>'"
                        .to_string(),
                )
            } else if file.starts_with('-') {
                Err(format!("unknown option '{}'", file))
            } else {
                Ok((Command::Run(RunOptions::default()), Some(file.to_string())))
            }
        }
    }
}

fn parse_run_args(args: &[String]) -> Result<(Command, Option<String>), String> {
    let mut options = RunOptions::default();
    let mut filename = None;
    let mut index = 0;

    while index < args.len() {
        let arg = &args[index];

        match arg.as_str() {
            "--safe" => options.safe = true,
            "--allow-network" => options.allow_network = true,
            "--allow-file-read" => options.allow_file_read = true,
            "--allow-file-write" => options.allow_file_write = true,
            "--allow-env" => options.allow_env = true,
            "--allow-root" => {
                index += 1;
                let root = args
                    .get(index)
                    .ok_or_else(|| "--allow-root requires a path".to_string())?;
                options.allowed_roots.push(PathBuf::from(root));
            }
            "--http-connect-timeout-ms" => {
                index += 1;
                options.http_connect_timeout_ms =
                    parse_u64_option(args.get(index), "--http-connect-timeout-ms")?;
            }
            "--http-timeout-ms" => {
                index += 1;
                options.http_request_timeout_ms =
                    parse_u64_option(args.get(index), "--http-timeout-ms")?;
            }
            "--http-max-body-bytes" => {
                index += 1;
                options.http_max_body_bytes =
                    parse_usize_option(args.get(index), "--http-max-body-bytes")?;
            }
            value if value.starts_with("--allow-root=") => {
                options
                    .allowed_roots
                    .push(PathBuf::from(&value["--allow-root=".len()..]));
            }
            value if value.starts_with("--http-connect-timeout-ms=") => {
                options.http_connect_timeout_ms = value["--http-connect-timeout-ms=".len()..]
                    .parse()
                    .map_err(|_| "--http-connect-timeout-ms expects a number".to_string())?;
            }
            value if value.starts_with("--http-timeout-ms=") => {
                options.http_request_timeout_ms = value["--http-timeout-ms=".len()..]
                    .parse()
                    .map_err(|_| "--http-timeout-ms expects a number".to_string())?;
            }
            value if value.starts_with("--http-max-body-bytes=") => {
                options.http_max_body_bytes = value["--http-max-body-bytes=".len()..]
                    .parse()
                    .map_err(|_| "--http-max-body-bytes expects a number".to_string())?;
            }
            value if value.starts_with('-') => return Err(format!("unknown option '{}'", value)),
            value => {
                if filename.is_some() {
                    return Err(format!("unexpected extra file '{}'", value));
                }
                filename = Some(value.to_string());
            }
        }

        index += 1;
    }

    Ok((Command::Run(options), filename))
}

fn parse_u64_option(value: Option<&String>, name: &str) -> Result<u64, String> {
    value
        .ok_or_else(|| format!("{} requires a value", name))?
        .parse()
        .map_err(|_| format!("{} expects a number", name))
}

fn parse_usize_option(value: Option<&String>, name: &str) -> Result<usize, String> {
    value
        .ok_or_else(|| format!("{} requires a value", name))?
        .parse()
        .map_err(|_| format!("{} expects a number", name))
}

fn run_command(command: Command, content: &str, filename: &str) {
    match command {
        Command::Run(options) => run_ast_runtime(content, filename, options),
        Command::Validate => validate_script(content, filename),
        Command::Tokens => print_tokens(content),
        Command::Ast => print_ast(content),
        Command::Help => print_usage(),
    }
}

fn validate_script(content: &str, filename: &str) {
    parse_source(content);
    println!("✓ SolveLang validation passed");
    println!("file: {}", filename);
}

fn print_tokens(content: &str) {
    let tokens = lexer::lex(content);
    println!("{:#?}", tokens);
}

fn print_ast(content: &str) {
    let ast = parse_source(content);
    println!("{:#?}", ast);
}

fn run_ast_runtime(content: &str, filename: &str, options: RunOptions) {
    let ast = parse_source(content);
    let policy = build_execution_policy(options).unwrap_or_else(|error| {
        eprintln!("Error: {}", error);
        process::exit(1);
    });
    let mut ast_runtime = ast_runtime::AstRuntime::with_source(policy, content, filename);
    if let Err(error) = ast_runtime.run(&ast) {
        eprintln!("{}", error);
        process::exit(1);
    }
}

fn build_execution_policy(options: RunOptions) -> Result<ExecutionPolicy, String> {
    let mut policy = if options.safe {
        ExecutionPolicy::safe(canonicalize_roots(&options.allowed_roots)?)
    } else {
        let mut policy = ExecutionPolicy::unrestricted();
        if !options.allowed_roots.is_empty() {
            policy.allowed_roots = canonicalize_roots(&options.allowed_roots)?;
            policy.restrict_filesystem_roots = true;
        }
        policy
    };

    if options.safe {
        policy.allow_network = options.allow_network;
        policy.allow_file_read = options.allow_file_read;
        policy.allow_file_write = options.allow_file_write;
        policy.allow_env = options.allow_env;
    }

    policy.http_connect_timeout = Duration::from_millis(options.http_connect_timeout_ms);
    policy.http_request_timeout = Duration::from_millis(options.http_request_timeout_ms);
    policy.http_max_body_bytes = options.http_max_body_bytes;

    Ok(policy)
}

fn canonicalize_roots(roots: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    roots
        .iter()
        .map(|root| {
            fs::canonicalize(root).map_err(|error| {
                format!(
                    "failed to resolve allowed root '{}': {}",
                    root.display(),
                    error
                )
            })
        })
        .collect()
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
    println!("  solvec run [options] <file.solve>  Run with the canonical AST runtime");
    println!("  solvec validate <file.solve>       Validate syntax without running");
    println!("  solvec tokens <file.solve>         Print lexer tokens");
    println!("  solvec ast <file.solve>            Print parsed AST");
    println!();
    println!("Run safety options:");
    println!("  --safe                             Deny network, file, and env access by default");
    println!("  --allow-network                    Allow http_get/http_post in safe mode");
    println!("  --allow-file-read                  Allow read_file in safe mode");
    println!("  --allow-file-write                 Allow write_file in safe mode");
    println!("  --allow-env                        Allow env in safe mode");
    println!("  --allow-root <path>                Restrict file access to an allowed root");
    println!("  --http-connect-timeout-ms <ms>     HTTP connect timeout, default 5000");
    println!("  --http-timeout-ms <ms>             HTTP request timeout, default 15000");
    println!("  --http-max-body-bytes <bytes>      HTTP response body limit, default 1048576");
    println!();
    println!("Backwards-compatible flags:");
    println!("  solvec <file.solve> --tokens");
    println!("  solvec <file.solve> --ast");
    println!();
    println!("Legacy runtime:");
    println!("  The public legacy command and --legacy flag have been removed.");
}
