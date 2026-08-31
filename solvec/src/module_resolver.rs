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

#[derive(Clone, Debug, PartialEq)]
pub struct ModuleNode {
    pub identity: String,
    pub exports: BTreeMap<String, ExportKind>,
    pub dependencies: Vec<String>,
    pub(crate) source: String,
    pub(crate) statements: Vec<Stmt>,
}

impl ModuleNode {
    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn statements(&self) -> &[Stmt] {
        &self.statements
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExportKind {
    Let,
    Function,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModuleGraph {
    pub root: PathBuf,
    pub modules: BTreeMap<String, ModuleNode>,
    pub order: Vec<String>,
}

/// An entry source whose canonical identity, root, source text, and parsed AST
/// were captured together. Resolution must begin from this value so an entry
/// path cannot be swapped between source loading and graph construction.
#[derive(Clone, Debug, PartialEq)]
pub struct FrozenEntry {
    canonical_path: PathBuf,
    root: PathBuf,
    source: String,
    statements: Vec<Stmt>,
}

impl FrozenEntry {
    pub fn read(entry: &Path) -> Result<Self, ModuleError> {
        let canonical_path = fs::canonicalize(entry).map_err(|error| {
            error_at(
                "<entry>",
                SourceLocation::new(1, 1),
                format!("failed to resolve entry source: {error}"),
            )
        })?;
        let root = entry_root(&canonical_path)?;
        let identity = relative_source_path(&canonical_path, &root);
        let source = fs::read_to_string(&canonical_path).map_err(|error| {
            error_at(
                &identity,
                SourceLocation::new(1, 1),
                format!("failed to read module: {error}"),
            )
        })?;
        let statements = parse_module_source(&source, &identity)?;
        Ok(Self {
            canonical_path,
            root,
            source,
            statements,
        })
    }

    pub fn from_parts(
        canonical_path: PathBuf,
        root: PathBuf,
        source: String,
        statements: Vec<Stmt>,
    ) -> Self {
        Self {
            canonical_path,
            root,
            source,
            statements,
        }
    }
}

pub fn resolve_explicit_modules(entry: &Path) -> Result<ModuleGraph, ModuleError> {
    let frozen_entry = FrozenEntry::read(entry)?;
    resolve_explicit_modules_from_frozen_entry(&frozen_entry)
}

pub fn resolve_explicit_modules_from_frozen_entry(
    entry: &FrozenEntry,
) -> Result<ModuleGraph, ModuleError> {
    let mut resolver = Resolver {
        root: entry.root.clone(),
        modules: BTreeMap::new(),
        canonical: HashMap::new(),
        stack: Vec::new(),
        order: Vec::new(),
    };
    resolver.visit_frozen_entry(entry)?;
    Ok(ModuleGraph {
        root: entry.root.clone(),
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
    fn visit_frozen_entry(&mut self, entry: &FrozenEntry) -> Result<String, ModuleError> {
        self.visit_loaded(
            &entry.canonical_path,
            entry.source.clone(),
            entry.statements.clone(),
        )
    }

    fn visit(&mut self, path: &Path) -> Result<String, ModuleError> {
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
        let statements = parse_module_source(&content, &identity)?;
        self.visit_loaded(path, content, statements)
    }

    fn visit_loaded(
        &mut self,
        path: &Path,
        content: String,
        statements: Vec<Stmt>,
    ) -> Result<String, ModuleError> {
        if let Some(identity) = self.canonical.get(path) {
            return Ok(identity.clone());
        }
        let identity = self.identity(path);
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
                source: content,
                statements,
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
        if let Some(start) = self.stack.iter().position(|item| item == &canonical) {
            let mut cycle = self.stack[start..]
                .iter()
                .map(|item| self.identity(item))
                .collect::<Vec<_>>();
            cycle.push(self.identity(&canonical));
            return Err(error_at(
                source,
                location,
                format!("explicit module cycle detected: {}", cycle.join(" -> ")),
            ));
        }
        self.visit(&canonical)
    }
    fn identity(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }
}

fn entry_root(entry: &Path) -> Result<PathBuf, ModuleError> {
    entry.parent().map(Path::to_path_buf).ok_or_else(|| {
        error_at(
            "<entry>",
            SourceLocation::new(1, 1),
            "could not determine entry source directory",
        )
    })
}

fn relative_source_path(canonical: &Path, source_root: &Path) -> String {
    canonical
        .strip_prefix(source_root)
        .unwrap_or(canonical)
        .to_string_lossy()
        .replace('\\', "/")
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
    use super::{
        ExportKind, FrozenEntry, resolve_explicit_modules,
        resolve_explicit_modules_from_frozen_entry,
    };
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
        fixture.write("b.solve", "\n\n  import \"a.solve\" as a\n");
        let error = resolve_explicit_modules(&fixture.entry()).expect_err("cycle fails");
        assert_eq!(error.source, "b.solve");
        assert_eq!(error.location.line, 3);
        assert_eq!(error.location.column, 3);
        assert!(error.message.contains("a.solve -> b.solve -> a.solve"));
        let repeated =
            resolve_explicit_modules(&fixture.entry()).expect_err("cycle remains deterministic");
        assert_eq!(error, repeated);

        fixture.write("entry.solve", "import \"a.solve\" as a\n");
        fixture.write("a.solve", "import \"b.solve\" as b\n");
        fixture.write("b.solve", "import \"c.solve\" as c\n");
        fixture.write("c.solve", "\nimport \"a.solve\" as a\n");
        let error = resolve_explicit_modules(&fixture.entry()).expect_err("three-file cycle fails");
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

    #[test]
    fn rejects_malformed_entries_instead_of_returning_an_incomplete_graph() {
        let fixture = Fixture::new();
        fixture.write(
            "entry.solve",
            "import \"dependency.solve\" as dependency\n@\n",
        );
        fixture.write("dependency.solve", "export let value = 1\n");

        let error = resolve_explicit_modules(&fixture.entry())
            .expect_err("malformed entry must not produce a graph");

        assert_eq!(error.source, "entry.solve");
        assert_eq!(error.location.line, 2);
    }

    #[test]
    fn rejects_entry_lexer_diagnostics_before_constructing_a_graph() {
        let fixture = Fixture::new();
        fixture.write("entry.solve", "export let value = \"unterminated\n");

        let error = resolve_explicit_modules(&fixture.entry())
            .expect_err("malformed entry must not produce a graph");

        assert_eq!(error.source, "entry.solve");
        assert_eq!(error.location.line, 1);
        assert!(error.message.contains("Unclosed string literal"));
    }

    #[test]
    fn frozen_entry_graph_uses_the_original_source_after_entry_replacement() {
        let fixture = Fixture::new();
        fixture.write("entry.solve", "import \"a.solve\" as module\n");
        fixture.write("a.solve", "export let value = 1\n");
        fixture.write("b.solve", "export let value = 2\n");

        let frozen = FrozenEntry::read(&fixture.entry()).expect("entry freezes");
        fixture.write("entry.solve", "import \"b.solve\" as module\n");

        let graph =
            resolve_explicit_modules_from_frozen_entry(&frozen).expect("frozen graph resolves");
        assert!(graph.modules.contains_key("a.solve"));
        assert!(!graph.modules.contains_key("b.solve"));
    }

    #[cfg(unix)]
    #[test]
    fn frozen_symlink_entry_keeps_its_original_canonical_root_and_source() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let root_a = fixture.root.join("root-a");
        let root_b = fixture.root.join("root-b");
        fs::create_dir_all(&root_a).expect("root a");
        fs::create_dir_all(&root_b).expect("root b");
        fs::write(root_a.join("entry.solve"), "import \"a.solve\" as module\n").expect("entry a");
        fs::write(root_a.join("a.solve"), "export let value = 1\n").expect("module a");
        fs::write(root_b.join("entry.solve"), "import \"b.solve\" as module\n").expect("entry b");
        fs::write(root_b.join("b.solve"), "export let value = 2\n").expect("module b");
        let entry_link = fixture.root.join("entry.solve");
        symlink(root_a.join("entry.solve"), &entry_link).expect("entry link a");

        let frozen = FrozenEntry::read(&entry_link).expect("entry freezes");
        fs::remove_file(&entry_link).expect("remove old entry link");
        symlink(root_b.join("entry.solve"), &entry_link).expect("entry link b");

        let graph =
            resolve_explicit_modules_from_frozen_entry(&frozen).expect("frozen graph resolves");
        assert_eq!(
            graph.root,
            fs::canonicalize(&root_a).expect("root a canonicalizes")
        );
        assert!(graph.modules.contains_key("a.solve"));
        assert!(!graph.modules.contains_key("b.solve"));
    }
}
