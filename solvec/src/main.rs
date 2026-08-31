use solvec::ast::{Expr, ExprKind, Stmt};
use solvec::ast_runtime::ExecutionPolicy;
use solvec::{
    ast_runtime, diagnostics, formatter, lexer, lint, module_resolver, parser, semantic, value,
};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process;
use std::time::Duration;
use value::Value;

const ADVISORY_LABEL: &str = "NON-PRODUCTION ADVISORY ONLY";
const MAX_INPUT_BYTES: u64 = 1_048_576;

#[derive(Debug, PartialEq)]
enum Command {
    Run(RunOptions),
    Validate,
    Check,
    Lint,
    Format { check: bool },
    Tokens,
    Ast,
    Help,
}

#[derive(Clone, Debug, PartialEq)]
struct RunOptions {
    safe: bool,
    dry_run: bool,
    no_network: bool,
    json: bool,
    input_path: Option<PathBuf>,
    allow_network: bool,
    allow_file_read: bool,
    allow_file_write: bool,
    allow_env: bool,
    allowed_roots: Vec<PathBuf>,
    http_connect_timeout_ms: u64,
    http_request_timeout_ms: u64,
    http_max_body_bytes: usize,
}

impl RunOptions {
    fn hardened(&self) -> bool {
        self.safe || self.dry_run || self.no_network || self.json
    }
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            safe: false,
            dry_run: false,
            no_network: false,
            json: false,
            input_path: None,
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

#[derive(Clone, Debug)]
struct SourceOrigin {
    path: String,
    line: usize,
    text: String,
}

#[derive(Clone, Debug)]
struct LoadedSource {
    content: String,
    origins: Vec<SourceOrigin>,
    entry_path: String,
}

impl LoadedSource {
    fn empty(entry_path: String) -> Self {
        Self {
            content: String::new(),
            origins: Vec::new(),
            entry_path,
        }
    }

    fn from_raw(entry_path: &str, content: &str) -> Self {
        Self {
            content: content.to_string(),
            origins: content
                .lines()
                .enumerate()
                .map(|(index, text)| SourceOrigin {
                    path: entry_path.to_string(),
                    line: index + 1,
                    text: text.trim_end_matches('\r').to_string(),
                })
                .collect(),
            entry_path: entry_path.to_string(),
        }
    }

    fn push_line(&mut self, path: &str, line: usize, text: &str) {
        self.content.push_str(text);
        self.content.push('\n');
        self.origins.push(SourceOrigin {
            path: path.to_string(),
            line,
            text: text.to_string(),
        });
    }

    fn append(&mut self, mut other: LoadedSource) {
        self.content.push_str(&other.content);
        self.origins.append(&mut other.origins);
    }

    fn origin(&self, global_line: usize) -> Option<&SourceOrigin> {
        self.origins.get(global_line.checked_sub(1)?)
    }

    fn format_diagnostics(&self, diagnostics: Vec<diagnostics::Diagnostic>) -> String {
        diagnostics
            .into_iter()
            .map(|diagnostic| {
                let Some(origin) = self.origin(diagnostic.line) else {
                    let source_line = self
                        .content
                        .lines()
                        .nth(diagnostic.line.saturating_sub(1))
                        .unwrap_or("");
                    return diagnostic.format(source_line);
                };
                let pointer_padding = " ".repeat(diagnostic.column.saturating_sub(1));
                let location = if origin.path == self.entry_path {
                    format!(
                        "SolveLang Error on line {}, column {}:",
                        origin.line, diagnostic.column
                    )
                } else {
                    format!(
                        "SolveLang Error on line {}, column {} in {}:",
                        origin.line, diagnostic.column, origin.path
                    )
                };
                format!(
                    "{}\n{}\n{}\n{}^\nHint: {}",
                    location, diagnostic.message, origin.text, pointer_padding, diagnostic.hint
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    fn format_warnings(&self, warnings: Vec<lint::Warning>) -> String {
        warnings
            .into_iter()
            .map(|warning| {
                let Some(origin) = self.origin(warning.line) else {
                    return format!(
                        "SolveLang Warning on line {}, column {}:\n{}\nHint: {}",
                        warning.line, warning.column, warning.message, warning.hint
                    );
                };
                let pointer_padding = " ".repeat(warning.column.saturating_sub(1));
                let location = if origin.path == self.entry_path {
                    format!(
                        "SolveLang Warning on line {}, column {}:",
                        origin.line, warning.column
                    )
                } else {
                    format!(
                        "SolveLang Warning on line {}, column {} in {}:",
                        origin.line, warning.column, origin.path
                    )
                };
                format!(
                    "{}\n{}\n{}\n{}^\nHint: {}",
                    location, warning.message, origin.text, pointer_padding, warning.hint
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    fn remap_runtime_message(&self, message: &str) -> String {
        const PREFIX: &str = "SolveLang Runtime Error on line ";
        let mut lines = message.lines();
        let Some(first) = lines.next() else {
            return message.to_string();
        };
        let Some(after_prefix) = first.strip_prefix(PREFIX) else {
            return message.to_string();
        };
        let Some((line_text, after_line)) = after_prefix.split_once(", column ") else {
            return message.to_string();
        };
        let Ok(global_line) = line_text.parse::<usize>() else {
            return message.to_string();
        };
        let column_digits = after_line
            .chars()
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>();
        let Ok(column) = column_digits.parse::<usize>() else {
            return message.to_string();
        };
        let Some(origin) = self.origin(global_line) else {
            return message.to_string();
        };
        let suffix = &after_line[column_digits.len()..];
        let mapped_suffix = if origin.path == self.entry_path {
            suffix.to_string()
        } else {
            format!(" in {}", origin.path)
        };

        let mut output = format!(
            "{}{}, column {}{}",
            PREFIX, origin.line, column, mapped_suffix
        );
        for (index, line) in lines.enumerate() {
            output.push('\n');
            if index == 0 && line.contains(" | ") {
                output.push_str(&format!("{:>3} | {}", origin.line, origin.text));
            } else {
                output.push_str(line);
            }
        }
        output
    }
}

#[derive(Debug)]
struct CliFailure {
    code: &'static str,
    public_message: &'static str,
    human_message: String,
    show_usage: bool,
}

impl CliFailure {
    fn arguments(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_arguments",
            public_message: "invalid command arguments",
            human_message: format!("Error: {}", message.into()),
            show_usage: true,
        }
    }

    fn source(message: impl Into<String>) -> Self {
        Self {
            code: "source_load_error",
            public_message: "workflow source could not be loaded",
            human_message: format!("Error: {}", message.into()),
            show_usage: false,
        }
    }

    fn import(message: impl Into<String>) -> Self {
        Self {
            code: "import_denied",
            public_message: "workflow import was denied by source policy",
            human_message: format!("Error: {}", message.into()),
            show_usage: false,
        }
    }

    fn input(code: &'static str, public_message: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            public_message,
            human_message: format!("Error: {}", message.into()),
            show_usage: false,
        }
    }

    fn invalid_workflow(human_message: impl Into<String>) -> Self {
        Self {
            code: "invalid_workflow",
            public_message: "workflow syntax or structure is invalid",
            human_message: human_message.into(),
            show_usage: false,
        }
    }

    fn preflight(
        code: &'static str,
        public_message: &'static str,
        human_message: impl Into<String>,
    ) -> Self {
        Self {
            code,
            public_message,
            human_message: format!("Error: {}", human_message.into()),
            show_usage: false,
        }
    }

    fn runtime(human_message: impl Into<String>) -> Self {
        Self {
            code: "runtime_error",
            public_message: "workflow evaluation failed",
            human_message: human_message.into(),
            show_usage: false,
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let json_requested = args.iter().any(|arg| arg == "--json");

    if let Err(error) = dispatch(&args) {
        if json_requested {
            emit_json_error(&error);
        } else {
            eprintln!("{}", error.human_message);
            if error.show_usage {
                print_usage();
            }
        }
        process::exit(1);
    }
}

fn dispatch(args: &[String]) -> Result<(), CliFailure> {
    let (command, filename) = parse_args(args).map_err(CliFailure::arguments)?;

    if matches!(command, Command::Help) {
        print_usage();
        return Ok(());
    }

    let filename = filename.ok_or_else(|| CliFailure::arguments("missing SolveLang file"))?;

    match command {
        Command::Run(options) => execute_run(&filename, options),
        Command::Validate => {
            let source = load_source_with_imports(&filename, false)?;
            validate_diagnostics(&source)?;
            parse_source(&source)?;
            println!("✓ SolveLang validation passed");
            println!("file: {}", filename);
            Ok(())
        }
        Command::Check => {
            let source = load_source_with_imports(&filename, false)?;
            validate_diagnostics(&source)?;
            let statements = parse_source(&source)?;
            semantic::check(&statements).map_err(|diagnostics| {
                CliFailure::invalid_workflow(source.format_diagnostics(diagnostics))
            })?;
            println!("✓ SolveLang semantic check passed");
            println!("file: {}", filename);
            Ok(())
        }
        Command::Lint => {
            let source = load_source_with_imports(&filename, false)?;
            validate_diagnostics(&source)?;
            let statements = parse_source(&source)?;
            let warnings = lint::lint(&statements);
            if warnings.is_empty() {
                println!("✓ SolveLang lint passed with no warnings");
            } else {
                println!("{}", source.format_warnings(warnings.clone()));
                println!(
                    "✓ SolveLang lint completed with {} warnings",
                    warnings.len()
                );
            }
            println!("file: {}", filename);
            Ok(())
        }
        Command::Format { check } => execute_format(&filename, check),
        Command::Tokens => {
            let source = load_source_with_imports(&filename, false)?;
            validate_diagnostics(&source)?;
            println!("{:#?}", lexer::lex(&source.content));
            Ok(())
        }
        Command::Ast => {
            let source = load_source_with_imports(&filename, false)?;
            validate_diagnostics(&source)?;
            println!("{:#?}", parse_source(&source)?);
            Ok(())
        }
        Command::Help => Ok(()),
    }
}

fn execute_run(filename: &str, options: RunOptions) -> Result<(), CliFailure> {
    validate_run_options(&options)?;

    // The effective runtime policy is deliberately constructed before any explicit
    // JSON input, workflow source, or workflow import is read.
    let policy = build_execution_policy(&options)
        .map_err(|message| CliFailure::arguments(format!("invalid execution policy: {message}")))?;
    let input = load_explicit_input(options.input_path.as_deref())?;
    let source = load_source_with_imports(filename, options.hardened())?;

    validate_diagnostics(&source)?;
    let statements = parse_source(&source)?;
    preflight_workflow(&statements, input.is_some(), options.hardened())?;

    let mut runtime =
        ast_runtime::AstRuntime::with_input(policy, &source.content, filename, input, options.json);
    if options.hardened() && !options.json {
        println!("{}", ADVISORY_LABEL);
    }
    runtime
        .run(&statements)
        .map_err(|error| CliFailure::runtime(source.remap_runtime_message(&error.to_string())))?;

    if options.json {
        let outputs = runtime
            .outputs()
            .iter()
            .map(Value::to_json)
            .collect::<Vec<_>>();
        let envelope = serde_json::json!({
            "advisory": ADVISORY_LABEL,
            "advisory_only": true,
            "dry_run": options.dry_run,
            "ok": true,
            "outputs": outputs,
        });
        println!(
            "{}",
            serde_json::to_string(&envelope).expect("JSON envelope serialization cannot fail")
        );
    }

    Ok(())
}

fn emit_json_error(error: &CliFailure) {
    let envelope = serde_json::json!({
        "advisory": ADVISORY_LABEL,
        "advisory_only": true,
        "errors": [{
            "code": error.code,
            "message": error.public_message,
        }],
        "ok": false,
    });
    println!(
        "{}",
        serde_json::to_string(&envelope).expect("JSON envelope serialization cannot fail")
    );
}

fn parse_args(args: &[String]) -> Result<(Command, Option<String>), String> {
    if args.is_empty() {
        return Ok((Command::Help, None));
    }

    match args[0].as_str() {
        "help" | "--help" | "-h" => {
            if args.len() == 1 {
                Ok((Command::Help, None))
            } else {
                Err("help does not accept extra arguments".to_string())
            }
        }
        "run" => parse_run_args(&args[1..]),
        "validate" => parse_file_command(Command::Validate, &args[1..]),
        "check" => parse_file_command(Command::Check, &args[1..]),
        "lint" => parse_file_command(Command::Lint, &args[1..]),
        "fmt" => parse_format_command(&args[1..]),
        "tokens" => parse_file_command(Command::Tokens, &args[1..]),
        "ast" => parse_file_command(Command::Ast, &args[1..]),
        "legacy" => Err(
            "legacy runtime has been removed from the public CLI; use 'solvec run <file.solve>'"
                .to_string(),
        ),
        file => {
            if args.len() == 2 && args[1] == "--tokens" {
                Ok((Command::Tokens, Some(file.to_string())))
            } else if args.len() == 2 && args[1] == "--ast" {
                Ok((Command::Ast, Some(file.to_string())))
            } else if args.iter().any(|arg| arg == "--legacy") {
                Err(
                    "--legacy has been removed from the public CLI; use 'solvec run <file.solve>'"
                        .to_string(),
                )
            } else if file.starts_with('-') {
                Err(format!("unknown option '{}'", file))
            } else if args.len() == 1 {
                Ok((Command::Run(RunOptions::default()), Some(file.to_string())))
            } else {
                Err("run options require the explicit 'solvec run' command".to_string())
            }
        }
    }
}

fn parse_format_command(args: &[String]) -> Result<(Command, Option<String>), String> {
    match args {
        [filename] if !filename.starts_with('-') => {
            Ok((Command::Format { check: false }, Some(filename.clone())))
        }
        [flag, filename] if flag == "--check" && !filename.starts_with('-') => {
            Ok((Command::Format { check: true }, Some(filename.clone())))
        }
        [] => Ok((Command::Format { check: false }, None)),
        _ => Err("fmt accepts one SolveLang file, optionally preceded by --check".to_string()),
    }
}

fn parse_file_command(
    command: Command,
    args: &[String],
) -> Result<(Command, Option<String>), String> {
    match args {
        [filename] if !filename.starts_with('-') => Ok((command, Some(filename.clone()))),
        [] => Ok((command, None)),
        _ => Err("command accepts exactly one SolveLang file".to_string()),
    }
}

fn execute_format(filename: &str, check: bool) -> Result<(), CliFailure> {
    let source = fs::read_to_string(filename).map_err(|error| {
        CliFailure::source(format!(
            "failed to read source file '{}': {}",
            filename, error
        ))
    })?;
    let raw_source = LoadedSource::from_raw(filename, &source);
    validate_diagnostics(&raw_source)?;
    parse_source(&raw_source)?;
    let formatted = formatter::format_source(&source);

    if check {
        if source != formatted {
            return Err(CliFailure::invalid_workflow(format!(
                "{} is not formatted; run 'solvec fmt {}'",
                filename, filename
            )));
        }
        println!("✓ SolveLang formatting check passed");
    } else {
        fs::write(filename, formatted).map_err(|error| {
            CliFailure::source(format!(
                "failed to write source file '{}': {}",
                filename, error
            ))
        })?;
        println!("✓ SolveLang formatting passed");
    }
    println!("file: {}", filename);
    Ok(())
}

fn parse_run_args(args: &[String]) -> Result<(Command, Option<String>), String> {
    let mut options = RunOptions::default();
    let mut filename = None;
    let mut index = 0;

    while index < args.len() {
        let arg = &args[index];

        match arg.as_str() {
            "--safe" => options.safe = true,
            "--dry-run" => options.dry_run = true,
            "--no-network" => options.no_network = true,
            "--json" => {
                if options.json {
                    return Err("--json may only be provided once".to_string());
                }
                options.json = true;
            }
            "--input" => {
                if options.input_path.is_some() {
                    return Err("--input may only be provided once".to_string());
                }
                index += 1;
                let path = args
                    .get(index)
                    .ok_or_else(|| "--input requires a file".to_string())?;
                if path.starts_with('-') {
                    return Err("--input requires a file".to_string());
                }
                options.input_path = Some(PathBuf::from(path));
            }
            "--allow-network" => options.allow_network = true,
            "--allow-file-read" => options.allow_file_read = true,
            "--allow-file-write" => options.allow_file_write = true,
            "--allow-env" => options.allow_env = true,
            "--allow-root" => {
                index += 1;
                let root = args
                    .get(index)
                    .ok_or_else(|| "--allow-root requires a path".to_string())?;
                if root.is_empty() || root.starts_with('-') {
                    return Err("--allow-root requires a path".to_string());
                }
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
            value if value.starts_with("--input=") => {
                if options.input_path.is_some() {
                    return Err("--input may only be provided once".to_string());
                }
                let path = &value["--input=".len()..];
                if path.is_empty() {
                    return Err("--input requires a file".to_string());
                }
                options.input_path = Some(PathBuf::from(path));
            }
            value if value.starts_with("--allow-root=") => {
                let path = &value["--allow-root=".len()..];
                if path.is_empty() || path.starts_with('-') {
                    return Err("--allow-root requires a path".to_string());
                }
                options.allowed_roots.push(PathBuf::from(path));
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

fn validate_run_options(options: &RunOptions) -> Result<(), CliFailure> {
    if options
        .http_max_body_bytes
        .checked_add(1)
        .and_then(|limit| u64::try_from(limit).ok())
        .is_none()
    {
        return Err(CliFailure::arguments("--http-max-body-bytes is too large"));
    }
    if options.hardened()
        && (options.allow_network
            || options.allow_file_read
            || options.allow_file_write
            || options.allow_env
            || !options.allowed_roots.is_empty())
    {
        return Err(CliFailure::arguments(
            "capability allow flags cannot be used in hardened mode",
        ));
    }
    Ok(())
}

fn build_execution_policy(options: &RunOptions) -> Result<ExecutionPolicy, String> {
    let mut policy = if options.hardened() {
        ExecutionPolicy::safe(Vec::new())
    } else {
        let mut policy = ExecutionPolicy::unrestricted();
        if !options.allowed_roots.is_empty() {
            policy.allowed_roots = canonicalize_roots(&options.allowed_roots)?;
            policy.restrict_filesystem_roots = true;
        }
        policy
    };

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

fn load_explicit_input(path: Option<&Path>) -> Result<Option<Value>, CliFailure> {
    let Some(path) = path else {
        return Ok(None);
    };

    let metadata = fs::symlink_metadata(path).map_err(|error| {
        CliFailure::input(
            "invalid_input",
            "input JSON could not be read",
            format!(
                "failed to inspect input file '{}': {}",
                path.display(),
                error
            ),
        )
    })?;
    if !metadata.file_type().is_file() {
        return Err(CliFailure::input(
            "invalid_input",
            "input must be an explicit regular JSON file",
            "input must be a regular file and may not be a symlink",
        ));
    }
    if metadata.len() > MAX_INPUT_BYTES {
        return Err(CliFailure::input(
            "input_too_large",
            "input JSON exceeds the 1 MiB limit",
            "input JSON exceeds the 1 MiB limit",
        ));
    }

    let file = fs::File::open(path).map_err(|error| {
        CliFailure::input(
            "invalid_input",
            "input JSON could not be read",
            format!("failed to read input file '{}': {}", path.display(), error),
        )
    })?;
    let mut bytes = Vec::with_capacity((metadata.len().min(MAX_INPUT_BYTES) + 1) as usize);
    file.take(MAX_INPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CliFailure::input(
                "invalid_input",
                "input JSON could not be read",
                format!("failed to read input file '{}': {}", path.display(), error),
            )
        })?;
    if bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err(CliFailure::input(
            "input_too_large",
            "input JSON exceeds the 1 MiB limit",
            "input JSON exceeds the 1 MiB limit",
        ));
    }

    let json = serde_json::from_slice(&bytes).map_err(|_| {
        CliFailure::input(
            "invalid_input",
            "input JSON is malformed or contains an unsupported number",
            "input JSON is malformed",
        )
    })?;
    Value::from_json(json).map(Some).map_err(|message| {
        CliFailure::input(
            "invalid_input",
            "input JSON is malformed or contains an unsupported number",
            message,
        )
    })
}

fn validate_diagnostics(source: &LoadedSource) -> Result<(), CliFailure> {
    diagnostics::validate_source(&source.content)
        .map_err(|diagnostics| CliFailure::invalid_workflow(source.format_diagnostics(diagnostics)))
}

fn parse_source(source: &LoadedSource) -> Result<Vec<Stmt>, CliFailure> {
    let tokens = lexer::lex(&source.content);
    let mut parser = parser::Parser::new(tokens);
    parser
        .parse()
        .map_err(|diagnostics| CliFailure::invalid_workflow(source.format_diagnostics(diagnostics)))
}

fn relative_source_path(canonical: &Path, source_root: &Path) -> String {
    canonical
        .strip_prefix(source_root)
        .unwrap_or(canonical)
        .to_string_lossy()
        .replace('\\', "/")
}

fn load_source_with_imports(filename: &str, hardened: bool) -> Result<LoadedSource, CliFailure> {
    let entry = fs::canonicalize(filename).map_err(|error| {
        CliFailure::source(format!("failed to resolve '{}': {}", filename, error))
    })?;
    let metadata = fs::metadata(&entry).map_err(|error| {
        CliFailure::source(format!(
            "failed to inspect '{}': {}",
            entry.display(),
            error
        ))
    })?;
    if !metadata.is_file() {
        return Err(CliFailure::source(
            "SolveLang entry source is not a regular file",
        ));
    }

    let source_root = entry
        .parent()
        .ok_or_else(|| CliFailure::source("could not determine entry source directory"))?
        .to_path_buf();
    let entry_path = relative_source_path(&entry, &source_root);
    let mut import_stack = Vec::new();
    let source = load_file_recursive(
        &entry,
        &source_root,
        &entry_path,
        hardened,
        &mut import_stack,
        true,
    )?;
    validate_diagnostics(&source)?;
    parse_source(&source)?;
    module_resolver::resolve_explicit_modules(&entry).map_err(|error| {
        CliFailure::invalid_workflow(format!(
            "{}:{}:{}: {}",
            error.source, error.location.line, error.location.column, error.message
        ))
    })?;
    Ok(source)
}

fn load_file_recursive(
    canonical: &Path,
    source_root: &Path,
    entry_path: &str,
    hardened: bool,
    import_stack: &mut Vec<PathBuf>,
    is_entry: bool,
) -> Result<LoadedSource, CliFailure> {
    if let Some(cycle_start) = import_stack.iter().position(|path| path == canonical) {
        let mut cycle = import_stack[cycle_start..]
            .iter()
            .map(|path| relative_source_path(path, source_root))
            .collect::<Vec<_>>();
        cycle.push(relative_source_path(canonical, source_root));
        let message = format!("circular import detected: {}", cycle.join(" -> "));
        return Err(if hardened && !is_entry {
            CliFailure::import(message)
        } else {
            CliFailure::source(message)
        });
    }
    import_stack.push(canonical.to_path_buf());

    let content = fs::read_to_string(canonical).map_err(|error| {
        let message = format!("failed to read '{}': {}", canonical.display(), error);
        if hardened && !is_entry {
            CliFailure::import(message)
        } else {
            CliFailure::source(message)
        }
    })?;
    let parent = canonical
        .parent()
        .ok_or_else(|| CliFailure::source("could not determine source parent directory"))?;
    let display_path = relative_source_path(canonical, source_root);
    let mut output = LoadedSource::empty(entry_path.to_string());

    for (index, line) in content.lines().enumerate() {
        let local_line = index + 1;
        let trimmed = line.trim();
        if let Some(import_path) = parse_import_line(trimmed) {
            let imported = resolve_import(parent, source_root, import_path, hardened)?;
            let imported_path = relative_source_path(&imported, source_root);
            let imported_source = load_file_recursive(
                &imported,
                source_root,
                entry_path,
                hardened,
                import_stack,
                false,
            )?;
            if imported_source.content.is_empty() {
                output.push_line(&imported_path, 1, "");
            } else {
                output.append(imported_source);
            }
        } else {
            output.push_line(&display_path, local_line, line);
        }
    }

    import_stack.pop();
    Ok(output)
}

fn resolve_import(
    parent: &Path,
    source_root: &Path,
    import_path: &str,
    hardened: bool,
) -> Result<PathBuf, CliFailure> {
    let path = Path::new(import_path);

    if hardened {
        let invalid_component = path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        });
        if import_path.is_empty()
            || import_path.contains('\0')
            || import_path.contains('\\')
            || path.is_absolute()
            || invalid_component
            || path.extension().and_then(|extension| extension.to_str()) != Some("solve")
        {
            return Err(CliFailure::import(
                "hardened imports require a relative .solve path without parent traversal",
            ));
        }
    }

    let candidate = parent.join(path);
    let canonical = fs::canonicalize(&candidate).map_err(|error| {
        let message = format!("failed to resolve import '{}': {}", import_path, error);
        if hardened {
            CliFailure::import(message)
        } else {
            CliFailure::source(message)
        }
    })?;

    if hardened && !canonical.starts_with(source_root) {
        return Err(CliFailure::import(
            "import resolves outside the entry workflow source root",
        ));
    }
    let metadata = fs::metadata(&canonical).map_err(|error| {
        let message = format!("failed to inspect import '{}': {}", import_path, error);
        if hardened {
            CliFailure::import(message)
        } else {
            CliFailure::source(message)
        }
    })?;
    if !metadata.is_file() {
        return Err(if hardened {
            CliFailure::import("import target is not a regular file")
        } else {
            CliFailure::source("import target is not a regular file")
        });
    }

    Ok(canonical)
}

fn parse_import_line(line: &str) -> Option<&str> {
    if !line.starts_with("import ") {
        return None;
    }

    let rest = line["import ".len()..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }

    let mut escaped = false;
    for (index, character) in rest.char_indices().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character == '"' {
            let trailing = rest[index + character.len_utf8()..].trim_start();
            return (trailing.is_empty() || trailing.starts_with("//")).then_some(&rest[1..index]);
        }
    }

    None
}

fn preflight_workflow(
    statements: &[Stmt],
    input_injected: bool,
    hardened: bool,
) -> Result<(), CliFailure> {
    let mut function_names = HashSet::new();
    preflight_statements(statements, input_injected, hardened, &mut function_names)
}

fn preflight_statements(
    statements: &[Stmt],
    input_injected: bool,
    hardened: bool,
    function_names: &mut HashSet<String>,
) -> Result<(), CliFailure> {
    for statement in statements {
        match statement {
            Stmt::LegacyInclude { .. }
            | Stmt::ModuleImport { .. }
            | Stmt::NamedModuleImport { .. }
            | Stmt::Export { .. } => {}
            Stmt::Let { name, value, .. } | Stmt::Assign { name, value, .. } => {
                if input_injected && name == "input" {
                    return Err(read_only_input_failure());
                }
                preflight_expr(value, hardened, function_names)?;
            }
            Stmt::Print { value, .. } | Stmt::Return { value, .. } | Stmt::Expr(value) => {
                preflight_expr(value, hardened, function_names)?;
            }
            Stmt::Function {
                name, params, body, ..
            } => {
                if input_injected
                    && (name == "input" || params.iter().any(|param| param == "input"))
                {
                    return Err(read_only_input_failure());
                }
                if hardened && is_explicitly_unsafe_name(name) {
                    return Err(capability_failure(
                        "unsafe function declarations are disabled by hardened execution policy",
                    ));
                }
                let mut body_function_names = function_names.clone();
                body_function_names.insert(name.clone());
                preflight_statements(body, input_injected, hardened, &mut body_function_names)?;
                function_names.insert(name.clone());
            }
            Stmt::If {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                preflight_expr(condition, hardened, function_names)?;
                let mut then_function_names = function_names.clone();
                preflight_statements(
                    then_branch,
                    input_injected,
                    hardened,
                    &mut then_function_names,
                )?;
                let mut else_function_names = function_names.clone();
                preflight_statements(
                    else_branch,
                    input_injected,
                    hardened,
                    &mut else_function_names,
                )?;
            }
            Stmt::While {
                condition, body, ..
            } => {
                preflight_expr(condition, hardened, function_names)?;
                let mut body_function_names = function_names.clone();
                preflight_statements(body, input_injected, hardened, &mut body_function_names)?;
            }
            Stmt::For { iterable, body, .. } => {
                preflight_expr(iterable, hardened, function_names)?;
                let mut body_function_names = function_names.clone();
                preflight_statements(body, input_injected, hardened, &mut body_function_names)?;
            }
            Stmt::Break { .. } | Stmt::Continue { .. } => {}
            Stmt::Agent { .. } if hardened => {
                return Err(capability_failure(
                    "agent declarations and tools are disabled by hardened execution policy",
                ));
            }
            Stmt::Agent { .. } => {}
            Stmt::Ask { message, .. } => {
                if hardened {
                    return Err(capability_failure(
                        "ask is disabled by hardened execution policy",
                    ));
                }
                preflight_expr(message, hardened, function_names)?;
            }
        }
    }
    Ok(())
}

fn preflight_expr(
    expr: &Expr,
    hardened: bool,
    function_names: &HashSet<String>,
) -> Result<(), CliFailure> {
    match &expr.kind {
        ExprKind::Array(values) => {
            for value in values {
                preflight_expr(value, hardened, function_names)?;
            }
        }
        ExprKind::Object(entries) => {
            for value in entries.values() {
                preflight_expr(value, hardened, function_names)?;
            }
        }
        ExprKind::Property(target, _) | ExprKind::Unary { expr: target, .. } => {
            preflight_expr(target, hardened, function_names)?;
        }
        ExprKind::Index(target, index) => {
            preflight_expr(target, hardened, function_names)?;
            preflight_expr(index, hardened, function_names)?;
        }
        ExprKind::Binary { left, right, .. } => {
            preflight_expr(left, hardened, function_names)?;
            preflight_expr(right, hardened, function_names)?;
        }
        ExprKind::Call { name, args } => {
            for arg in args {
                preflight_expr(arg, hardened, function_names)?;
            }
            if hardened {
                if let Some(message) = denied_builtin_message(name) {
                    return Err(capability_failure(message));
                }
                let allowed = matches!(
                    name.as_str(),
                    "length"
                        | "is_empty"
                        | "contains"
                        | "get"
                        | "keys"
                        | "values"
                        | "entries"
                        | "json_parse"
                        | "json_stringify"
                ) || (function_names.contains(name)
                    && !is_explicitly_unsafe_name(name));
                if !allowed {
                    return Err(capability_failure(
                        "unknown or unsafe function calls are disabled by hardened execution policy",
                    ));
                }
            }
        }
        ExprKind::ModuleCall { args, .. } => {
            for arg in args {
                preflight_expr(arg, hardened, function_names)?;
            }
        }
        ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => {}
    }
    Ok(())
}

fn denied_builtin_message(name: &str) -> Option<&'static str> {
    match name {
        "http_get" | "http_post" => {
            Some("network access is disabled by execution policy (hardened mode)")
        }
        "read_file" => Some("file read access is disabled by execution policy (hardened mode)"),
        "write_file" => Some("file write access is disabled by execution policy (hardened mode)"),
        "env" => {
            Some("environment-variable access is disabled by execution policy (hardened mode)")
        }
        _ => None,
    }
}

fn is_explicitly_unsafe_name(name: &str) -> bool {
    matches!(
        name,
        "shell"
            | "shell_exec"
            | "exec"
            | "process"
            | "spawn"
            | "plugin"
            | "load_plugin"
            | "stripe"
            | "stripe_charge"
            | "send_email"
            | "linear_create_issue"
            | "db_write"
            | "delete_file"
    )
}

fn capability_failure(human_message: &'static str) -> CliFailure {
    CliFailure::preflight(
        "capability_denied",
        "workflow contains a capability disabled by hardened execution policy",
        human_message,
    )
}

fn read_only_input_failure() -> CliFailure {
    CliFailure::preflight(
        "read_only_input",
        "the injected input value is read-only",
        "the injected input value cannot be declared, assigned, or shadowed",
    )
}

fn print_usage() {
    println!("SolveLang Compiler");
    println!();
    println!("Usage:");
    println!("  solvec run [options] <file.solve>  Run with the canonical AST runtime");
    println!("  solvec validate <file.solve>       Validate syntax without running");
    println!(
        "  solvec check <file.solve>          Check conservative static semantics without running"
    );
    println!("  solvec lint <file.solve>           Report conservative warnings without running");
    println!("  solvec fmt [--check] <file.solve>  Format source without changing meaning");
    println!("  solvec tokens <file.solve>         Print lexer tokens");
    println!("  solvec ast <file.solve>            Print parsed AST");
    println!();
    println!("Local structured-run options:");
    println!("  --input <file>                     Inject strict JSON as read-only 'input'");
    println!("  --json                             Emit one hardened deterministic JSON envelope");
    println!("  --safe                             Deny runtime capabilities and unsafe tools");
    println!("  --dry-run                          Evaluate pure logic after static preflight");
    println!("  --no-network                       Enable strict hardened execution");
    println!();
    println!("Unhardened capability options:");
    println!("  --allow-network                    Accepted only outside hardened modes");
    println!("  --allow-file-read                  Accepted only outside hardened modes");
    println!("  --allow-file-write                 Accepted only outside hardened modes");
    println!("  --allow-env                        Accepted only outside hardened modes");
    println!("  --allow-root <path>                Restrict unhardened file access to a root");
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
