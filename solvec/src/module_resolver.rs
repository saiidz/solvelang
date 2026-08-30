//! Read-only graph validation for explicit local SolveLang modules.
//!
//! This deliberately builds and validates a graph only. It neither evaluates
//! a module nor changes legacy compatibility-include loading.

use crate::{
    ast::{ExportedDeclaration, SourceLocation, Stmt},
    diagnostics, lexer, parser,
};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModuleError {
    pub source: String,
    pub location: SourceLocation,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModuleNode {
    pub identity: String,
    pub exports: BTreeMap<String, ExportKind>,
    pub dependencies: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExportKind {
    Let,
    Function,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModuleGraph {
    pub root: PathBuf,
    pub modules: BTreeMap<String, ModuleNode>,
    pub order: Vec<String>,
}

pub fn resolve_explicit_modules(entry: &Path) -> Result<ModuleGraph, ModuleError> {
    let entry = fs::canonicalize(entry).map_err(|error| {
        error_at(
            "<entry>",
            SourceLocation::new(1, 1),
            format!("failed to resolve entry source: {error}"),
        )
    })?;
    let root = entry
        .parent()
        .ok_or_else(|| {
            error_at(
                "<entry>",
                SourceLocation::new(1, 1),
                "could not determine entry source directory",
            )
        })?
        .to_path_buf();
    let mut resolver = Resolver {
        root: root.clone(),
        modules: BTreeMap::new(),
        canonical: HashMap::new(),
        stack: Vec::new(),
        order: Vec::new(),
    };
    resolver.visit(&entry, true)?;
    Ok(ModuleGraph {
        root,
        modules: resolver.modules,
        order: resolver.order,
    })
}

struct Resolver {
    root: PathBuf,
    modules: BTreeMap<String, ModuleNode>,
    canonical: HashMap<PathBuf, String>,
    stack: Vec<PathBuf>,
    order: Vec<String>,
}

impl Resolver {
    fn visit(&mut self, path: &Path, is_entry: bool) -> Result<String, ModuleError> {
        if let Some(identity) = self.canonical.get(path) {
            return Ok(identity.clone());
        }
        if let Some(start) = self.stack.iter().position(|item| item == path) {
            let mut cycle = self.stack[start..]
                .iter()
                .map(|item| self.identity(item))
                .collect::<Vec<_>>();
            cycle.push(self.identity(path));
            return Err(error_at(
                &self.identity(path),
                SourceLocation::new(1, 1),
                format!("explicit module cycle detected: {}", cycle.join(" -> ")),
            ));
        }
        let identity = self.identity(path);
        let content = fs::read_to_string(path).map_err(|error| {
            error_at(
                &identity,
                SourceLocation::new(1, 1),
                format!("failed to read module: {error}"),
            )
        })?;
        if let Err(diagnostics) = diagnostics::validate_source(&content)
            && !is_entry
        {
            let diagnostic = diagnostics
                .into_iter()
                .next()
                .expect("validation reports an error");
            return Err(error_at(
                &identity,
                SourceLocation::new(diagnostic.line, diagnostic.column),
                diagnostic.message,
            ));
        }
        let statements = match parser::Parser::new(lexer::lex(&content)).parse() {
            Ok(statements) => statements,
            Err(_) if is_entry => Vec::new(),
            Err(errors) => {
                let error = errors.into_iter().next().expect("parser reports an error");
                return Err(error_at(
                    &identity,
                    SourceLocation::new(error.line, error.column),
                    error.message,
                ));
            }
        };
        self.stack.push(path.to_path_buf());
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
                } => dependencies.push(self.resolve_target(path, target, *location, &identity)?),
                Stmt::NamedModuleImport {
                    path: target,
                    bindings,
                    location,
                } => {
                    let target_identity =
                        self.resolve_target(path, target, *location, &identity)?;
                    let target_exports = self
                        .modules
                        .get(&target_identity)
                        .expect("resolved dependency is available")
                        .exports
                        .clone();
                    for binding in bindings {
                        if !target_exports.contains_key(&binding.exported) {
                            return Err(error_at(
                                &identity,
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
        self.canonical.insert(path.to_path_buf(), identity.clone());
        self.modules.insert(
            identity.clone(),
            ModuleNode {
                identity: identity.clone(),
                exports,
                dependencies,
            },
        );
        self.order.push(identity.clone());
        Ok(identity)
    }
    fn resolve_target(
        &mut self,
        parent: &Path,
        target: &str,
        location: SourceLocation,
        source: &str,
    ) -> Result<String, ModuleError> {
        let path = Path::new(target);
        if target.is_empty()
            || target.contains('\0')
            || target.contains('\\')
            || path.is_absolute()
            || path.components().any(|part| {
                matches!(
                    part,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
            || path.extension().and_then(|part| part.to_str()) != Some("solve")
        {
            return Err(error_at(
                source,
                location,
                "explicit modules require a relative .solve path without parent traversal or backslashes",
            ));
        }
        let candidate = parent
            .parent()
            .expect("canonical module has parent")
            .join(path);
        let canonical = fs::canonicalize(&candidate).map_err(|_| {
            error_at(
                source,
                location,
                format!("failed to resolve explicit module '{}'", target),
            )
        })?;
        if !canonical.starts_with(&self.root) {
            return Err(error_at(
                source,
                location,
                "explicit module resolves outside the entry workflow source root",
            ));
        }
        if !fs::metadata(&canonical)
            .map_err(|_| {
                error_at(
                    source,
                    location,
                    format!("failed to inspect explicit module '{}'", target),
                )
            })?
            .is_file()
        {
            return Err(error_at(
                source,
                location,
                "explicit module target is not a regular file",
            ));
        }
        self.visit(&canonical, false)
    }
    fn identity(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }
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
    use super::{ExportKind, resolve_explicit_modules};
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);

    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "solvelang_module_graph_{}_{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).expect("fixture root");
            Self { root }
        }
        fn write(&self, path: &str, source: &str) {
            let file = self.root.join(path);
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent).expect("fixture parent");
            }
            fs::write(file, source).expect("fixture source");
        }
        fn entry(&self) -> PathBuf {
            self.root.join("entry.solve")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn resolves_export_surfaces_once_in_deterministic_dependency_order() {
        let fixture = Fixture::new();
        fixture.write("entry.solve", "import \"lib/math.solve\" as math\nimport { api_version as value } from \"lib/math.solve\"\n");
        fixture.write(
            "lib/math.solve",
            "export let api_version = 42\nexport fn add(left, right) { return left + right }\n",
        );
        let graph = resolve_explicit_modules(&fixture.entry()).expect("module graph");
        assert_eq!(graph.modules.len(), 2);
        assert_eq!(graph.order, vec!["lib/math.solve", "entry.solve"]);
        assert_eq!(
            graph.modules["lib/math.solve"].exports["api_version"],
            ExportKind::Let
        );
        assert_eq!(
            graph.modules["lib/math.solve"].exports["add"],
            ExportKind::Function
        );
    }

    #[test]
    fn reports_missing_private_exports_at_import_location() {
        let fixture = Fixture::new();
        fixture.write("entry.solve", "import { hidden } from \"lib.solve\"\n");
        fixture.write("lib.solve", "let hidden = 1\n");
        let error = resolve_explicit_modules(&fixture.entry()).expect_err("private export fails");
        assert_eq!(error.source, "entry.solve");
        assert_eq!(error.location.line, 1);
        assert!(error.message.contains("does not export 'hidden'"));
    }

    #[test]
    fn rejects_unsafe_paths_and_reports_deterministic_cycles() {
        let fixture = Fixture::new();
        fixture.write("entry.solve", "import \"../outside.solve\" as outside\n");
        let error = resolve_explicit_modules(&fixture.entry()).expect_err("traversal fails");
        assert!(
            error.message.contains("relative .solve path"),
            "unexpected traversal error: {error:?}"
        );
        fixture.write("entry.solve", "import \"a.solve\" as a\n");
        fixture.write("a.solve", "import \"b.solve\" as b\n");
        fixture.write("b.solve", "import \"a.solve\" as a\n");
        let error = resolve_explicit_modules(&fixture.entry()).expect_err("cycle fails");
        assert!(error.message.contains("a.solve -> b.solve -> a.solve"));
    }

    #[test]
    fn ignores_legacy_includes_when_constructing_explicit_module_graph() {
        let fixture = Fixture::new();
        fixture.write(
            "entry.solve",
            "import \"legacy.solve\" // compatibility include\nimport \"module.solve\" as module\n",
        );
        fixture.write("module.solve", "export let value = 1\n");
        let graph = resolve_explicit_modules(&fixture.entry()).expect("explicit graph");
        assert_eq!(graph.modules.len(), 2);
        assert!(graph.modules.contains_key("module.solve"));
    }

    #[test]
    fn validates_imported_source_before_parser_acceptance() {
        let fixture = Fixture::new();
        fixture.write("entry.solve", "import \"module.solve\" as module\n");
        fixture.write("module.solve", "export let value = \"unterminated\n");
        let error =
            resolve_explicit_modules(&fixture.entry()).expect_err("malformed dependency fails");
        assert_eq!(error.source, "module.solve");
        assert_eq!(error.location.line, 1);
        assert!(error.message.contains("Unclosed string literal"));
    }
}
