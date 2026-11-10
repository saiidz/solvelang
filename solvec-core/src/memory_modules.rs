//! In-memory graph resolution for explicit local SolveLang modules.
//!
//! This is the host-incapable twin of the native CLI's filesystem resolver
//! (`solvec::module_resolver`). It builds and validates the same module graph
//! from an in-memory map of module identity to source text instead of files
//! on disk, and produces the core [`ModuleProgram`] the evaluator consumes.
//! It performs no filesystem or host access of any kind.
//!
//! Semantics intentionally mirror the CLI resolver:
//!
//! - Import targets must be non-empty relative `.solve` paths without parent
//!   traversal, backslashes, or NUL bytes.
//! - Targets resolve relative to the importing module's directory within the
//!   map's key space. The map is the whole universe: a target that is absent
//!   from the map fails to resolve.
//! - A module reached through different spellings of the same normalized path
//!   (for example `lib/math.solve` and `./lib/math.solve`) is resolved once.
//! - Cycles are reported with the same identity chain text as the CLI.
//! - Named imports are checked against the target module's export surface,
//!   and legacy compatibility includes are ignored, exactly as natively.
//! - Initialization order is post-order: dependencies before dependents,
//!   with the entry module last.
//!
//! Deliberate differences from the CLI, all consequences of having no
//! filesystem: identities are the caller-provided map keys rather than paths
//! relative to the entry file's directory (the two agree whenever the entry
//! sits at the map root, as in every native fixture); there is no symlink or
//! hardlink canonicalization; and the CLI's "resolves outside the entry
//! workflow source root" and "not a regular file" failures have no analogue,
//! because every map entry is a module inside the root by construction.

use crate::ast::{ExportedDeclaration, SourceLocation, Stmt};
use crate::diagnostics;
use crate::evaluator::{ExportKind, ModuleNode, ModuleProgram};
use crate::lexer;
use crate::parser;
use std::collections::{BTreeMap, HashSet};

/// A module graph failure, located in the module that caused it.
///
/// This mirrors the native resolver's `solvec::module_resolver::ModuleError`
/// field for field so callers can format in-memory and filesystem failures
/// through one path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModuleError {
    pub source: String,
    pub location: SourceLocation,
    pub message: String,
}

/// Resolve the explicit module graph rooted at `entry` from an in-memory
/// source map, without touching the filesystem.
///
/// `entry` is the map key of the entry module and `sources` maps every
/// module identity to its source text. The returned [`ModuleProgram`] is
/// ready for [`crate::evaluator::Evaluator::run_modules`].
pub fn resolve_memory_modules(
    entry: &str,
    sources: &BTreeMap<String, String>,
) -> Result<ModuleProgram, ModuleError> {
    let Some(entry_source) = sources.get(entry) else {
        return Err(error_at(
            "<entry>",
            SourceLocation::new(1, 1),
            "failed to resolve entry source: no module with that identity exists in the in-memory source map",
        ));
    };
    let entry_statements = parse_module_source(entry_source, entry)?;
    let mut resolver = Resolver {
        sources,
        modules: BTreeMap::new(),
        resolved: HashSet::new(),
        stack: Vec::new(),
        order: Vec::new(),
    };
    let entry = resolver.visit_loaded(entry, entry_source.clone(), entry_statements)?;
    Ok(ModuleProgram {
        entry,
        modules: resolver.modules,
        order: resolver.order,
    })
}

struct Resolver<'a> {
    sources: &'a BTreeMap<String, String>,
    modules: BTreeMap<String, ModuleNode>,
    resolved: HashSet<String>,
    stack: Vec<String>,
    order: Vec<String>,
}

impl Resolver<'_> {
    fn visit(&mut self, identity: &str) -> Result<String, ModuleError> {
        if self.resolved.contains(identity) {
            return Ok(identity.to_string());
        }
        if let Some(start) = self.stack.iter().position(|item| item == identity) {
            let mut cycle = self.stack[start..].to_vec();
            cycle.push(identity.to_string());
            return Err(error_at(
                identity,
                SourceLocation::new(1, 1),
                format!("explicit module cycle detected: {}", cycle.join(" -> ")),
            ));
        }
        let Some(source) = self.sources.get(identity) else {
            return Err(error_at(
                identity,
                SourceLocation::new(1, 1),
                "failed to read module: not present in the in-memory source map",
            ));
        };
        let source = source.clone();
        let statements = parse_module_source(&source, identity)?;
        self.visit_loaded(identity, source, statements)
    }

    fn visit_loaded(
        &mut self,
        identity: &str,
        content: String,
        statements: Vec<Stmt>,
    ) -> Result<String, ModuleError> {
        if self.resolved.contains(identity) {
            return Ok(identity.to_string());
        }
        self.stack.push(identity.to_string());
        let mut exports = BTreeMap::new();
        let mut dependencies = Vec::new();
        for statement in &statements {
            match statement {
                Stmt::Export { declaration, .. } => {
                    let (name, kind) = match declaration {
                        ExportedDeclaration::Let { name, .. } => (name, ExportKind::Let),
                        ExportedDeclaration::Function { name, .. } => (name, ExportKind::Function),
                    };
                    exports.insert(name.clone(), kind);
                }
                Stmt::ModuleImport {
                    path: target,
                    location,
                    ..
                } => dependencies.push(self.resolve_target(identity, target, *location)?),
                Stmt::NamedModuleImport {
                    path: target,
                    bindings,
                    location,
                } => {
                    let target_identity = self.resolve_target(identity, target, *location)?;
                    let target_exports = self
                        .modules
                        .get(&target_identity)
                        .expect("resolved dependency is available")
                        .exports
                        .clone();
                    for binding in bindings {
                        if !target_exports.contains_key(&binding.exported) {
                            return Err(error_at(
                                identity,
                                binding.exported_location,
                                format!(
                                    "module '{}' does not export '{}'",
                                    target_identity, binding.exported
                                ),
                            ));
                        }
                    }
                    dependencies.push(target_identity);
                }
                _ => {}
            }
        }
        self.stack.pop();
        self.resolved.insert(identity.to_string());
        self.modules.insert(
            identity.to_string(),
            ModuleNode {
                identity: identity.to_string(),
                source: content,
                statements,
                dependencies,
                exports,
            },
        );
        self.order.push(identity.to_string());
        Ok(identity.to_string())
    }

    fn resolve_target(
        &mut self,
        importer: &str,
        target: &str,
        location: SourceLocation,
    ) -> Result<String, ModuleError> {
        if !is_valid_module_target(target) {
            return Err(error_at(
                importer,
                location,
                "explicit modules require a relative .solve path without parent traversal or backslashes",
            ));
        }
        let identity = resolve_target_identity(importer, target);
        if !self.sources.contains_key(&identity) {
            return Err(error_at(
                importer,
                location,
                format!("failed to resolve explicit module '{}'", target),
            ));
        }
        if let Some(start) = self.stack.iter().position(|item| item == &identity) {
            let mut cycle = self.stack[start..].to_vec();
            cycle.push(identity.clone());
            return Err(error_at(
                importer,
                location,
                format!("explicit module cycle detected: {}", cycle.join(" -> ")),
            ));
        }
        self.visit(&identity)
    }
}

/// The CLI resolver's target contract, on the raw target string: a non-empty
/// relative `.solve` path with no NUL bytes, no backslashes, and no parent
/// traversal. Current-directory segments are allowed and normalized away
/// when the target identity is computed, as canonicalization does natively.
fn is_valid_module_target(target: &str) -> bool {
    if target.is_empty()
        || target.contains('\0')
        || target.contains('\\')
        || target.starts_with('/')
        || target.split('/').any(|part| part == "..")
    {
        return false;
    }
    let file_name = target.rsplit('/').next().unwrap_or("");
    let extension = match file_name.rfind('.') {
        Some(index) if index > 0 => Some(&file_name[index + 1..]),
        _ => None,
    };
    extension == Some("solve")
}

/// Join `target` onto the importing module's directory and normalize the
/// result into a module identity. The target has already been validated, so
/// only empty and current-directory segments need to collapse here.
fn resolve_target_identity(importer: &str, target: &str) -> String {
    let mut parts: Vec<&str> = importer.split('/').collect();
    parts.pop();
    for part in target.split('/') {
        match part {
            "" | "." => {}
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

fn parse_module_source(source: &str, identity: &str) -> Result<Vec<Stmt>, ModuleError> {
    if let Err(diagnostics) = diagnostics::validate_source(source) {
        let diagnostic = diagnostics
            .into_iter()
            .next()
            .expect("validation reports an error");
        return Err(error_at(
            identity,
            SourceLocation::new(diagnostic.line, diagnostic.column),
            diagnostic.message,
        ));
    }
    parser::Parser::new(lexer::lex(source))
        .parse()
        .map_err(|errors| {
            let error = errors.into_iter().next().expect("parser reports an error");
            error_at(
                identity,
                SourceLocation::new(error.line, error.column),
                error.message,
            )
        })
}

fn error_at(source: &str, location: SourceLocation, message: impl Into<String>) -> ModuleError {
    ModuleError {
        source: source.to_string(),
        location,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{ModuleError, resolve_memory_modules};
    use crate::evaluator::{DenyAllHost, Evaluator, ExportKind};
    use std::collections::BTreeMap;

    fn sources(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(identity, source)| (identity.to_string(), source.to_string()))
            .collect()
    }

    #[test]
    fn resolves_export_surfaces_once_in_deterministic_dependency_order() {
        let map = sources(&[
            (
                "entry.solve",
                "import \"lib/math.solve\" as math\nimport { api_version as value } from \"lib/math.solve\"\n",
            ),
            (
                "lib/math.solve",
                "export let api_version = 42\nexport fn add(left, right) { return left + right }\n",
            ),
        ]);
        let program = resolve_memory_modules("entry.solve", &map).expect("module program");
        assert_eq!(program.entry, "entry.solve");
        assert_eq!(program.modules.len(), 2);
        assert_eq!(program.order, vec!["lib/math.solve", "entry.solve"]);
        assert_eq!(
            program.modules["lib/math.solve"].exports["api_version"],
            ExportKind::Let
        );
        assert_eq!(
            program.modules["lib/math.solve"].exports["add"],
            ExportKind::Function
        );
        // Both import statements name the same module; it resolves once and
        // both dependency edges are preserved, as in the native graph.
        assert_eq!(
            program.modules["entry.solve"].dependencies,
            vec!["lib/math.solve", "lib/math.solve"]
        );
    }

    #[test]
    fn reports_missing_private_exports_at_import_location() {
        let map = sources(&[
            ("entry.solve", "import { hidden } from \"lib.solve\"\n"),
            ("lib.solve", "let hidden = 1\n"),
        ]);
        let error = resolve_memory_modules("entry.solve", &map).expect_err("private export fails");
        assert_eq!(error.source, "entry.solve");
        assert_eq!(error.location.line, 1);
        assert!(error.message.contains("does not export 'hidden'"));
    }

    #[test]
    fn reports_missing_modules_with_the_native_message() {
        let map = sources(&[("entry.solve", "import \"ghost.solve\" as ghost\n")]);
        let error = resolve_memory_modules("entry.solve", &map).expect_err("missing module fails");
        assert_eq!(error.source, "entry.solve");
        assert_eq!(error.location.line, 1);
        assert_eq!(
            error.message,
            "failed to resolve explicit module 'ghost.solve'"
        );
    }

    #[test]
    fn reports_a_missing_entry_without_a_graph() {
        let map = sources(&[("present.solve", "export let value = 1\n")]);
        let error = resolve_memory_modules("absent.solve", &map).expect_err("missing entry fails");
        assert_eq!(error.source, "<entry>");
        assert!(error.message.contains("failed to resolve entry source"));
    }

    #[test]
    fn rejects_unsafe_paths_and_reports_deterministic_cycles() {
        let map = sources(&[("entry.solve", "import \"../outside.solve\" as outside\n")]);
        let error = resolve_memory_modules("entry.solve", &map).expect_err("traversal fails");
        assert!(
            error.message.contains("relative .solve path"),
            "unexpected traversal error: {error:?}"
        );

        let map = sources(&[
            ("entry.solve", "import \"a.solve\" as a\n"),
            ("a.solve", "import \"b.solve\" as b\n"),
            ("b.solve", "\n\n  import \"a.solve\" as a\n"),
        ]);
        let error = resolve_memory_modules("entry.solve", &map).expect_err("cycle fails");
        assert_eq!(error.source, "b.solve");
        assert_eq!(error.location.line, 3);
        assert_eq!(error.location.column, 3);
        assert!(error.message.contains("a.solve -> b.solve -> a.solve"));
        let repeated = resolve_memory_modules("entry.solve", &map).expect_err("cycle is stable");
        assert_eq!(error, repeated);

        let map = sources(&[
            ("entry.solve", "import \"a.solve\" as a\n"),
            ("a.solve", "import \"b.solve\" as b\n"),
            ("b.solve", "import \"c.solve\" as c\n"),
            ("c.solve", "\nimport \"a.solve\" as a\n"),
        ]);
        let error = resolve_memory_modules("entry.solve", &map).expect_err("three-file cycle");
        assert_eq!(error.source, "c.solve");
        assert_eq!(error.location.line, 2);
        assert!(
            error
                .message
                .contains("a.solve -> b.solve -> c.solve -> a.solve")
        );
    }

    #[test]
    fn ignores_legacy_includes_when_constructing_explicit_module_graph() {
        let map = sources(&[
            (
                "entry.solve",
                "import \"legacy.solve\" // compatibility include\nimport \"module.solve\" as module\n",
            ),
            ("module.solve", "export let value = 1\n"),
        ]);
        let program = resolve_memory_modules("entry.solve", &map).expect("explicit graph");
        assert_eq!(program.modules.len(), 2);
        assert!(program.modules.contains_key("module.solve"));
    }

    #[test]
    fn validates_imported_source_before_parser_acceptance() {
        let map = sources(&[
            ("entry.solve", "import \"module.solve\" as module\n"),
            ("module.solve", "export let value = \"unterminated\n"),
        ]);
        let error =
            resolve_memory_modules("entry.solve", &map).expect_err("malformed dependency fails");
        assert_eq!(error.source, "module.solve");
        assert_eq!(error.location.line, 1);
        assert!(error.message.contains("Unclosed string literal"));
    }

    #[test]
    fn rejects_malformed_entries_instead_of_returning_an_incomplete_graph() {
        let map = sources(&[
            (
                "entry.solve",
                "import \"dependency.solve\" as dependency\n@\n",
            ),
            ("dependency.solve", "export let value = 1\n"),
        ]);
        let error = resolve_memory_modules("entry.solve", &map)
            .expect_err("malformed entry must not produce a graph");
        assert_eq!(error.source, "entry.solve");
        assert_eq!(error.location.line, 2);
    }

    #[test]
    fn rejects_entry_lexer_diagnostics_before_constructing_a_graph() {
        let map = sources(&[("entry.solve", "export let value = \"unterminated\n")]);
        let error = resolve_memory_modules("entry.solve", &map)
            .expect_err("malformed entry must not produce a graph");
        assert_eq!(error.source, "entry.solve");
        assert_eq!(error.location.line, 1);
        assert!(error.message.contains("Unclosed string literal"));
    }

    #[test]
    fn resolves_relative_to_the_importing_modules_directory() {
        let map = sources(&[
            ("app/main.solve", "import \"lib/util.solve\" as util\n"),
            (
                "app/lib/util.solve",
                "import \"common.solve\" as common\nexport let value = 1\n",
            ),
            ("app/lib/common.solve", "export let base = 1\n"),
        ]);
        let program = resolve_memory_modules("app/main.solve", &map).expect("nested program");
        assert_eq!(program.entry, "app/main.solve");
        assert_eq!(
            program.order,
            vec![
                "app/lib/common.solve",
                "app/lib/util.solve",
                "app/main.solve"
            ]
        );
    }

    #[test]
    fn resolves_diamond_dependencies_once_in_post_order() {
        let map = sources(&[
            (
                "entry.solve",
                "import \"a.solve\" as a\nimport \"b.solve\" as b\n",
            ),
            ("a.solve", "import \"shared.solve\" as shared\n"),
            ("b.solve", "import \"./shared.solve\" as shared\n"),
            ("shared.solve", "export let value = 1\n"),
        ]);
        let program = resolve_memory_modules("entry.solve", &map).expect("diamond program");
        assert_eq!(program.modules.len(), 4);
        assert_eq!(
            program.order,
            vec!["shared.solve", "a.solve", "b.solve", "entry.solve"]
        );
        assert_eq!(
            program.modules["entry.solve"].dependencies,
            vec!["a.solve", "b.solve"]
        );
    }

    #[test]
    fn resolved_programs_execute_with_native_module_semantics() {
        let map = sources(&[
            (
                "entry.solve",
                "import { add, api_version } from \"lib/math.solve\"\nprint(add(20, 22))\nprint(api_version)\n",
            ),
            (
                "lib/math.solve",
                "export let api_version = 42\nexport fn add(left, right) { return left + right }\n",
            ),
        ]);
        let program = resolve_memory_modules("entry.solve", &map).expect("module program");
        let entry = &program.modules["entry.solve"];
        let mut evaluator =
            Evaluator::with_input(DenyAllHost, &entry.source, &entry.identity, None);
        evaluator
            .run_modules(&program)
            .expect("module program executes");
        let outputs: Vec<serde_json::Value> = evaluator
            .outputs()
            .iter()
            .map(crate::value::Value::to_json)
            .collect();
        assert_eq!(outputs, vec![serde_json::json!(42), serde_json::json!(42)]);
    }

    #[test]
    fn module_errors_match_the_native_shape() {
        let error = ModuleError {
            source: "entry.solve".to_string(),
            location: crate::ast::SourceLocation::new(1, 1),
            message: "example".to_string(),
        };
        assert_eq!(error.source, "entry.solve");
        assert_eq!(error.location.line, 1);
        assert_eq!(error.message, "example");
    }
}
