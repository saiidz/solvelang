use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use solvec_core::evaluator::{
    EvaluationLimits, Evaluator, ExportKind as CoreExportKind, ModuleNode as CoreModuleNode,
    ModuleProgram, RuntimeErrorKind, bounded_syntax_snapshot_bytes, bounded_syntax_snapshot_work,
    structural_byte_limit,
};

use crate::ast::Stmt;
use crate::module_resolver::{ExportKind, ModuleGraph};
use crate::native_host::NativeHost;
use crate::value::Value;

pub use solvec_core::evaluator::RuntimeError;

#[derive(Clone, Debug)]
pub struct ExecutionPolicy {
    pub allow_network: bool,
    pub allow_file_read: bool,
    pub allow_file_write: bool,
    pub allow_env: bool,
    pub allowed_roots: Vec<PathBuf>,
    pub restrict_filesystem_roots: bool,
    pub http_connect_timeout: Duration,
    pub http_request_timeout: Duration,
    pub http_max_body_bytes: usize,
}

impl ExecutionPolicy {
    pub const DEFAULT_HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
    pub const DEFAULT_HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
    pub const DEFAULT_HTTP_MAX_BODY_BYTES: usize = 1_048_576;

    pub fn unrestricted() -> Self {
        Self {
            allow_network: true,
            allow_file_read: true,
            allow_file_write: true,
            allow_env: true,
            allowed_roots: Vec::new(),
            restrict_filesystem_roots: false,
            http_connect_timeout: Self::DEFAULT_HTTP_CONNECT_TIMEOUT,
            http_request_timeout: Self::DEFAULT_HTTP_REQUEST_TIMEOUT,
            http_max_body_bytes: Self::DEFAULT_HTTP_MAX_BODY_BYTES,
        }
    }

    pub fn safe(allowed_roots: Vec<PathBuf>) -> Self {
        Self {
            allow_network: false,
            allow_file_read: false,
            allow_file_write: false,
            allow_env: false,
            allowed_roots,
            restrict_filesystem_roots: true,
            http_connect_timeout: Self::DEFAULT_HTTP_CONNECT_TIMEOUT,
            http_request_timeout: Self::DEFAULT_HTTP_REQUEST_TIMEOUT,
            http_max_body_bytes: Self::DEFAULT_HTTP_MAX_BODY_BYTES,
        }
    }

    pub(crate) fn deny_unknown_calls(&self) -> bool {
        self.restrict_filesystem_roots
            && !self.allow_network
            && !self.allow_file_read
            && !self.allow_file_write
            && !self.allow_env
    }
}

/// Backward-compatible native runtime façade over the host-agnostic core evaluator.
pub struct AstRuntime {
    evaluator: Evaluator<NativeHost>,
    capture_output: bool,
}

impl Default for AstRuntime {
    fn default() -> Self {
        Self {
            evaluator: Evaluator::new(NativeHost::new(ExecutionPolicy::unrestricted(), false))
                .with_output_retention(false),
            capture_output: false,
        }
    }
}

impl AstRuntime {
    pub fn with_input(
        policy: ExecutionPolicy,
        source: &str,
        filename: &str,
        input: Option<Value>,
        capture_output: bool,
    ) -> Self {
        Self {
            evaluator: Evaluator::with_input(
                NativeHost::new(policy, capture_output),
                source,
                filename,
                input,
            )
            .with_output_retention(capture_output),
            capture_output,
        }
    }

    pub fn outputs(&self) -> &[Value] {
        if self.capture_output {
            self.evaluator.outputs()
        } else {
            &[]
        }
    }

    pub fn run(&mut self, statements: &[Stmt]) -> Result<(), RuntimeError> {
        self.evaluator.run(statements)
    }

    pub fn run_with_modules(
        &mut self,
        graph: &ModuleGraph,
        statements: &[Stmt],
    ) -> Result<(), RuntimeError> {
        validate_module_graph_projection(graph, statements, self.evaluator.limits())?;
        let program = project_module_graph(graph, statements)?;
        self.evaluator.run_modules(&program)
    }
}

fn validate_module_graph_projection(
    graph: &ModuleGraph,
    entry_statements: &[Stmt],
    limits: EvaluationLimits,
) -> Result<(), RuntimeError> {
    let entry = graph
        .order
        .last()
        .ok_or_else(|| RuntimeError::new("explicit module graph is empty"))?;
    let structural_limit = structural_byte_limit(limits);
    // Match the core snapshot budget exactly: every node costs one byte and
    // one work unit, while every retained string also costs its bytes plus a
    // terminator. This preflight runs before cloning the native graph.
    let mut bytes = 1usize.saturating_add(entry.len()).saturating_add(2);
    let mut work = 2usize;

    for identity in &graph.order {
        bytes = bytes.saturating_add(identity.len()).saturating_add(2);
        work = work.saturating_add(1);
    }
    if bytes > structural_limit || work > limits.max_steps {
        return Err(RuntimeError::with_kind(
            RuntimeErrorKind::LimitExceeded,
            "native module projection exceeded deterministic resource limits",
        ));
    }
    for (identity, node) in &graph.modules {
        let statements = if identity == entry {
            entry_statements
        } else {
            node.statements()
        };
        bytes = bytes
            .saturating_add(1)
            .saturating_add(identity.len())
            .saturating_add(2)
            .saturating_add(node.identity.len())
            .saturating_add(2)
            .saturating_add(node.source().len())
            .saturating_add(2)
            .saturating_add(bounded_syntax_snapshot_bytes(statements, limits)?);
        work = work
            .saturating_add(4)
            .saturating_add(bounded_syntax_snapshot_work(statements, limits)?);
        for dependency in &node.dependencies {
            bytes = bytes.saturating_add(dependency.len()).saturating_add(2);
            work = work.saturating_add(1);
        }
        for export in node.exports.keys() {
            bytes = bytes.saturating_add(export.len()).saturating_add(3);
            work = work.saturating_add(2);
        }
        if bytes > structural_limit || work > limits.max_steps {
            return Err(RuntimeError::with_kind(
                RuntimeErrorKind::LimitExceeded,
                "native module projection exceeded deterministic resource limits",
            ));
        }
    }
    Ok(())
}

fn project_module_graph(
    graph: &ModuleGraph,
    entry_statements: &[Stmt],
) -> Result<ModuleProgram, RuntimeError> {
    let entry = graph
        .order
        .last()
        .cloned()
        .ok_or_else(|| RuntimeError::new("explicit module graph is empty"))?;
    if !graph.modules.contains_key(&entry) {
        return Err(RuntimeError::new(
            "explicit module entry is missing from the graph",
        ));
    }

    let modules = graph
        .modules
        .iter()
        .map(|(identity, node)| {
            let exports = node
                .exports
                .iter()
                .map(|(name, kind)| {
                    let kind = match kind {
                        ExportKind::Let => CoreExportKind::Let,
                        ExportKind::Function => CoreExportKind::Function,
                    };
                    (name.clone(), kind)
                })
                .collect::<BTreeMap<_, _>>();
            let statements = if identity == &entry {
                entry_statements.to_vec()
            } else {
                node.statements().to_vec()
            };
            (
                identity.clone(),
                CoreModuleNode {
                    identity: node.identity.clone(),
                    source: node.source().to_string(),
                    statements,
                    exports,
                    dependencies: node.dependencies.clone(),
                },
            )
        })
        .collect();

    Ok(ModuleProgram {
        entry,
        modules,
        order: graph.order.clone(),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use super::{AstRuntime, ExecutionPolicy, validate_module_graph_projection};
    use crate::lexer;
    use crate::module_resolver::{ExportKind, ModuleGraph, ModuleNode};
    use crate::parser::Parser;
    use crate::value::Value;
    use solvec_core::evaluator::{Capability, EvaluationLimits, RuntimeErrorKind};

    fn parse(source: &str) -> Vec<crate::ast::Stmt> {
        Parser::new(lexer::lex(source))
            .parse()
            .expect("source parses")
    }

    #[test]
    fn facade_preserves_capture_and_plain_output_views() {
        let source = "print(1 + 2)\n";
        let statements = parse(source);
        let mut captured = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            source,
            "captured.solve",
            None,
            true,
        );
        captured.run(&statements).expect("captured run succeeds");
        assert_eq!(captured.outputs(), &[Value::Number(3)]);

        let mut streamed = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            source,
            "streamed.solve",
            None,
            false,
        );
        streamed.run(&statements).expect("streamed run succeeds");
        assert!(streamed.outputs().is_empty());
        assert!(
            streamed.evaluator.outputs().is_empty(),
            "streamed output must not be retained behind the facade"
        );
    }

    #[test]
    fn facade_preserves_incremental_plain_runtime_reuse() {
        let first = "let value = 4\nfn read() { return value }\nprint(value)\n";
        let second = "print(value + 1)\nprint(read())\n";
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            first,
            "incremental.solve",
            None,
            true,
        );

        runtime.run(&parse(first)).expect("first run succeeds");
        runtime
            .run(&parse(second))
            .expect("second run reuses variables and functions");

        assert_eq!(
            runtime.outputs(),
            &[Value::Number(4), Value::Number(5), Value::Number(4)]
        );
    }

    #[test]
    fn safe_facade_denies_unsafe_function_names_before_captured_output() {
        let source = "print(\"must not print\")\nfn shell() { return 1 }\n";
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            source,
            "safe.solve",
            None,
            true,
        );

        let error = runtime
            .run(&parse(source))
            .expect_err("safe native policy fails closed during preflight");

        assert_eq!(error.kind(), RuntimeErrorKind::CapabilityDenied);
        assert_eq!(
            error.capability(),
            Some(&Capability::UnknownCall("shell".to_string()))
        );
        assert!(runtime.outputs().is_empty());
    }

    #[test]
    fn facade_projects_native_module_graph_into_core_program() {
        let dependency_source = "export let number = 4\n";
        let entry_source = "import \"value.solve\" as value\nprint(value.number)\n";
        let graph = ModuleGraph {
            root: PathBuf::new(),
            modules: BTreeMap::from([
                (
                    "value.solve".to_string(),
                    ModuleNode {
                        identity: "value.solve".to_string(),
                        exports: BTreeMap::from([("number".to_string(), ExportKind::Let)]),
                        dependencies: Vec::new(),
                        source: dependency_source.to_string(),
                        statements: parse(dependency_source),
                    },
                ),
                (
                    "entry.solve".to_string(),
                    ModuleNode {
                        identity: "entry.solve".to_string(),
                        exports: BTreeMap::new(),
                        dependencies: vec!["value.solve".to_string()],
                        source: entry_source.to_string(),
                        statements: parse(entry_source),
                    },
                ),
            ]),
            order: vec!["value.solve".to_string(), "entry.solve".to_string()],
        };
        let mut runtime = AstRuntime::with_input(
            ExecutionPolicy::safe(Vec::new()),
            entry_source,
            "entry.solve",
            None,
            true,
        );

        runtime
            .run_with_modules(&graph, &parse(entry_source))
            .expect("module run succeeds");

        assert_eq!(runtime.outputs(), &[Value::Number(4)]);
    }

    #[test]
    fn native_projection_counts_source_bytes_as_structure_not_execution_steps() {
        let source = format!("// {}\n", "comment".repeat(2_000));
        let graph = ModuleGraph {
            root: PathBuf::new(),
            modules: BTreeMap::from([(
                "entry.solve".to_string(),
                ModuleNode {
                    identity: "entry.solve".to_string(),
                    exports: BTreeMap::new(),
                    dependencies: Vec::new(),
                    source: source.clone(),
                    statements: Vec::new(),
                },
            )]),
            order: vec!["entry.solve".to_string()],
        };

        validate_module_graph_projection(
            &graph,
            &[],
            EvaluationLimits {
                max_loop_iterations: 1,
                max_steps: 7,
                max_call_depth: 8,
                max_value_bytes: 128,
            },
        )
        .expect("large source text consumes structural bytes, not execution steps");
    }
}
