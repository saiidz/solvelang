//! Minimal stdio LSP transport for full-document diagnostics and bounded open-document module navigation.
//!
//! Versioned full-text changes update bounded opened-document state. Cross-file module tooling
//! consults only those already-open documents; filesystem crawling, source
//! execution, and network access are intentionally unsupported.

use serde_json::{Value, json};
use solvec::{
    ast::{ExportedDeclaration, Expr, ExprKind, SourceLocation, Stmt},
    formatter, lexer, parser,
};
use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, BufReader, Read, Write};

#[derive(Clone, Debug)]
struct ExportInfo {
    name: String,
    kind: &'static str,
    location: SourceLocation,
    params: usize,
}

#[derive(Clone, Debug)]
struct NamespaceImport {
    path: String,
}

#[derive(Clone, Debug)]
struct NamedImport {
    path: String,
    exported: String,
    local: String,
}

fn diagnostics(text: &str) -> Vec<Value> {
    let mut parser = parser::Parser::new(lexer::lex(text));
    match parser.parse() {
        Ok(_) => Vec::new(),
        Err(errors) => errors
            .into_iter()
            .map(|error| json!({
                "range": {"start": {"line": error.line.saturating_sub(1), "character": error.column.saturating_sub(1)}, "end": {"line": error.line.saturating_sub(1), "character": error.column}},
                "severity": 1,
                "source": "solvec",
                "message": error.message,
            }))
            .collect(),
    }
}

fn parse_document(text: &str) -> Option<Vec<Stmt>> {
    let mut parser = parser::Parser::new(lexer::lex(text));
    parser.parse().ok()
}

fn symbols(text: &str) -> Vec<Value> {
    let Some(statements) = parse_document(text) else {
        return Vec::new();
    };
    statements
        .into_iter()
        .flat_map(|statement| match statement {
            Stmt::Let { name, location, .. } => {
                vec![document_symbol(text, name, location, 13, false)]
            }
            Stmt::Function { name, location, .. } => {
                vec![document_symbol(text, name, location, 12, false)]
            }
            Stmt::Export {
                declaration: ExportedDeclaration::Let { name, location, .. },
                ..
            } => vec![document_symbol(text, name, location, 13, false)],
            Stmt::Export {
                declaration: ExportedDeclaration::Function { name, location, .. },
                ..
            } => vec![document_symbol(text, name, location, 12, false)],
            Stmt::ModuleImport {
                namespace,
                namespace_location,
                ..
            } => vec![document_symbol(
                text,
                namespace,
                namespace_location,
                3,
                true,
            )],
            Stmt::NamedModuleImport { bindings, .. } => bindings
                .into_iter()
                .map(|binding| {
                    document_symbol(text, binding.local, binding.local_location, 13, true)
                })
                .collect(),
            Stmt::Agent { name, location, .. } => {
                vec![document_symbol(text, name, location, 5, false)]
            }
            _ => Vec::new(),
        })
        .collect()
}

fn source_range(text: &str, location: SourceLocation, name: &str) -> Value {
    let start = utf16_character_at(text, location.line, location.column)
        .unwrap_or_else(|| location.column.saturating_sub(1));
    let end = start + name.encode_utf16().count();
    json!({"start":{"line":location.line.saturating_sub(1),"character":start},"end":{"line":location.line.saturating_sub(1),"character":end}})
}

fn declaration_range(location: SourceLocation) -> Value {
    json!({"start":{"line":location.line.saturating_sub(1),"character":location.column.saturating_sub(1)},"end":{"line":location.line.saturating_sub(1),"character":location.column}})
}

fn declaration_name_range(text: &str, location: SourceLocation, name: &str) -> Value {
    lexer::lex(text)
        .into_iter()
        .find_map(|located| match located.token {
            lexer::Token::Identifier(candidate)
                if candidate == name
                    && located.line == location.line
                    && located.column >= location.column =>
            {
                Some(source_range(
                    text,
                    SourceLocation::new(located.line, located.column),
                    name,
                ))
            }
            _ => None,
        })
        .unwrap_or_else(|| declaration_range(location))
}

fn document_symbol(
    text: &str,
    name: String,
    location: SourceLocation,
    kind: u8,
    is_identifier_location: bool,
) -> Value {
    let range = if is_identifier_location {
        source_range(text, location, &name)
    } else {
        declaration_range(location)
    };
    json!({"name":name,"kind":kind,"range":range,"selectionRange":range})
}

fn token_start_utf16(text: &str, token: &lexer::LocatedToken) -> usize {
    utf16_character_at(text, token.line, token.column)
        .unwrap_or_else(|| token.column.saturating_sub(1))
}

fn identifier_index_at_position(text: &str, line: usize, character: usize) -> Option<usize> {
    lexer::lex(text)
        .iter()
        .enumerate()
        .find_map(|(index, located)| match &located.token {
            lexer::Token::Identifier(name) if located.line == line + 1 => {
                let start = token_start_utf16(text, located);
                (character >= start && character < start + name.encode_utf16().count())
                    .then_some(index)
            }
            _ => None,
        })
}

fn identifier_at_position(text: &str, line: usize, character: usize) -> Option<String> {
    let tokens = lexer::lex(text);
    let index = tokens
        .iter()
        .enumerate()
        .find_map(|(index, located)| match &located.token {
            lexer::Token::Identifier(name) if located.line == line + 1 => {
                let start = token_start_utf16(text, located);
                (character >= start && character < start + name.encode_utf16().count())
                    .then_some(index)
            }
            _ => None,
        })?;
    match &tokens[index].token {
        lexer::Token::Identifier(name) => Some(name.clone()),
        _ => None,
    }
}

fn member_at_position(text: &str, line: usize, character: usize) -> Option<(String, String)> {
    let tokens = lexer::lex(text);
    let index = identifier_index_at_position(text, line, character)?;
    if index < 2 || !matches!(&tokens[index - 1].token, lexer::Token::Dot) {
        return None;
    }
    let lexer::Token::Identifier(namespace) = &tokens[index - 2].token else {
        return None;
    };
    let lexer::Token::Identifier(member) = &tokens[index].token else {
        return None;
    };
    Some((namespace.clone(), member.clone()))
}

fn namespace_before_completion(text: &str, line: usize, character: usize) -> Option<String> {
    let source_line = text.lines().nth(line)?;
    let mut prefix = String::new();
    let mut units = 0usize;
    for character_value in source_line.chars() {
        let width = character_value.len_utf16();
        if units + width > character {
            break;
        }
        prefix.push(character_value);
        units += width;
    }
    let trimmed = prefix.trim_end();
    let before_dot = trimmed.strip_suffix('.')?.trim_end();
    let mut reversed = before_dot
        .chars()
        .rev()
        .take_while(|value| value.is_alphanumeric() || *value == '_')
        .collect::<String>();
    if reversed.is_empty() {
        return None;
    }
    reversed = reversed.chars().rev().collect();
    Some(reversed)
}

fn top_level_symbol(text: &str, name: &str) -> Option<(SourceLocation, &'static str)> {
    let statements = parse_document(text)?;
    statements
        .into_iter()
        .find_map(|statement| match statement {
            Stmt::Let {
                name: declared,
                location,
                ..
            } if declared == name => Some((location, "variable")),
            Stmt::Function {
                name: declared,
                location,
                ..
            } if declared == name => Some((location, "function")),
            Stmt::Export {
                declaration:
                    ExportedDeclaration::Let {
                        name: declared,
                        location,
                        ..
                    },
                ..
            } if declared == name => Some((location, "variable")),
            Stmt::Export {
                declaration:
                    ExportedDeclaration::Function {
                        name: declared,
                        location,
                        ..
                    },
                ..
            } if declared == name => Some((location, "function")),
            Stmt::ModuleImport {
                namespace,
                namespace_location,
                ..
            } if namespace == name => Some((namespace_location, "module namespace")),
            Stmt::NamedModuleImport { bindings, .. } => bindings.into_iter().find_map(|binding| {
                (binding.local == name).then_some((binding.local_location, "imported binding"))
            }),
            Stmt::Agent {
                name: declared,
                location,
                ..
            } if declared == name => Some((location, "agent")),
            _ => None,
        })
}

fn export_infos(text: &str) -> Vec<ExportInfo> {
    let Some(statements) = parse_document(text) else {
        return Vec::new();
    };
    statements
        .into_iter()
        .filter_map(|statement| match statement {
            Stmt::Export {
                declaration: ExportedDeclaration::Let { name, location, .. },
                ..
            } => Some(ExportInfo {
                name,
                kind: "variable",
                location,
                params: 0,
            }),
            Stmt::Export {
                declaration:
                    ExportedDeclaration::Function {
                        name,
                        params,
                        location,
                        ..
                    },
                ..
            } => Some(ExportInfo {
                name,
                kind: "function",
                location,
                params: params.len(),
            }),
            _ => None,
        })
        .collect()
}

fn export_info(text: &str, name: &str) -> Option<ExportInfo> {
    export_infos(text)
        .into_iter()
        .find(|export| export.name == name)
}

fn import_statements(text: &str) -> Vec<Stmt> {
    if let Some(statements) = parse_document(text) {
        return statements
            .into_iter()
            .filter(|statement| {
                matches!(
                    statement,
                    Stmt::ModuleImport { .. } | Stmt::NamedModuleImport { .. }
                )
            })
            .collect();
    }

    let mut imports = Vec::new();
    for line in text.lines() {
        if !line.trim_start().starts_with("import ") {
            continue;
        }
        let mut parser = parser::Parser::new(lexer::lex(line));
        if let Ok(statements) = parser.parse() {
            imports.extend(statements.into_iter().filter(|statement| {
                matches!(
                    statement,
                    Stmt::ModuleImport { .. } | Stmt::NamedModuleImport { .. }
                )
            }));
        }
    }
    imports
}

fn namespace_import(text: &str, namespace: &str) -> Option<NamespaceImport> {
    import_statements(text)
        .into_iter()
        .find_map(|statement| match statement {
            Stmt::ModuleImport {
                path,
                namespace: declared,
                ..
            } if declared == namespace => Some(NamespaceImport { path }),
            _ => None,
        })
}

fn named_import(text: &str, local: &str) -> Option<NamedImport> {
    import_statements(text)
        .into_iter()
        .find_map(|statement| match statement {
            Stmt::NamedModuleImport { path, bindings, .. } => bindings
                .into_iter()
                .find(|binding| binding.local == local)
                .map(|binding| NamedImport {
                    path,
                    exported: binding.exported,
                    local: binding.local,
                }),
            _ => None,
        })
}

fn resolve_import_uri(importer: &str, import_path: &str) -> Option<String> {
    let path = std::path::Path::new(import_path);
    if import_path.is_empty()
        || import_path.contains('\0')
        || import_path.contains('\\')
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
        || path.extension().and_then(|part| part.to_str()) != Some("solve")
    {
        return None;
    }

    let mut target = reqwest::Url::parse(importer).ok()?;
    if target.cannot_be_a_base() {
        return None;
    }
    target.set_query(None);
    target.set_fragment(None);
    {
        let mut segments = target.path_segments_mut().ok()?;
        segments.pop_if_empty();
        segments.pop();
        for segment in import_path.split('/') {
            if segment.is_empty() || segment == "." {
                continue;
            }
            segments.push(segment);
        }
    }
    Some(target.to_string())
}

fn later_location(left: SourceLocation, right: SourceLocation) -> SourceLocation {
    if (right.line, right.column) > (left.line, left.column) {
        right
    } else {
        left
    }
}

fn expr_latest_location(expr: &Expr) -> SourceLocation {
    let mut latest = expr.location;
    match &expr.kind {
        ExprKind::Array(items) => {
            for item in items {
                latest = later_location(latest, expr_latest_location(item));
            }
        }
        ExprKind::Object(entries) => {
            for value in entries.values() {
                latest = later_location(latest, expr_latest_location(value));
            }
        }
        ExprKind::Property(target, _) => {
            latest = later_location(latest, expr_latest_location(target));
        }
        ExprKind::Index(target, index) => {
            latest = later_location(latest, expr_latest_location(target));
            latest = later_location(latest, expr_latest_location(index));
        }
        ExprKind::Unary { expr, .. } => {
            latest = later_location(latest, expr_latest_location(expr));
        }
        ExprKind::Binary { left, right, .. } => {
            latest = later_location(latest, expr_latest_location(left));
            latest = later_location(latest, expr_latest_location(right));
        }
        ExprKind::Call { args, .. } | ExprKind::ModuleCall { args, .. } => {
            for arg in args {
                latest = later_location(latest, expr_latest_location(arg));
            }
        }
        ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => {}
    }
    latest
}

fn collect_for_scopes(statements: &[Stmt], scopes: &mut Vec<(String, SourceLocation)>) {
    for statement in statements {
        match statement {
            Stmt::For {
                name,
                iterable,
                body,
                ..
            } => {
                scopes.push((name.clone(), expr_latest_location(iterable)));
                collect_for_scopes(body, scopes);
            }
            Stmt::Function { body, .. } | Stmt::While { body, .. } => {
                collect_for_scopes(body, scopes);
            }
            Stmt::Export {
                declaration: ExportedDeclaration::Function { body, .. },
                ..
            } => collect_for_scopes(body, scopes),
            Stmt::If {
                then_branch,
                else_branch,
                ..
            } => {
                collect_for_scopes(then_branch, scopes);
                collect_for_scopes(else_branch, scopes);
            }
            _ => {}
        }
    }
}

fn scope_statements(text: &str) -> Option<Vec<Stmt>> {
    parse_document(text).or_else(|| {
        let mut repaired = text.to_string();
        repaired.push_str("__solvelsp_completion");
        parse_document(&repaired)
    })
}

fn collect_let_activations(statements: &[Stmt], activations: &mut Vec<(String, SourceLocation)>) {
    for statement in statements {
        match statement {
            Stmt::Let { name, value, .. } => {
                activations.push((name.clone(), expr_latest_location(value)));
            }
            Stmt::Function { body, .. } | Stmt::While { body, .. } => {
                collect_let_activations(body, activations);
            }
            Stmt::Export {
                declaration: ExportedDeclaration::Function { body, .. },
                ..
            } => collect_let_activations(body, activations),
            Stmt::For { body, .. } => collect_let_activations(body, activations),
            Stmt::If {
                then_branch,
                else_branch,
                ..
            } => {
                collect_let_activations(then_branch, activations);
                collect_let_activations(else_branch, activations);
            }
            _ => {}
        }
    }
}

fn let_activations(text: &str) -> Vec<(String, SourceLocation)> {
    let Some(statements) = scope_statements(text) else {
        return Vec::new();
    };
    let mut activations = Vec::new();
    collect_let_activations(&statements, &mut activations);
    activations
}

fn token_is_after_location(token: &lexer::LocatedToken, location: SourceLocation) -> bool {
    (token.line, token.column) > (location.line, location.column)
}

fn function_scope_bindings(
    text: &str,
    tokens: &[lexer::LocatedToken],
) -> HashMap<usize, Vec<String>> {
    let mut bindings = HashMap::<usize, Vec<String>>::new();
    for (index, token) in tokens.iter().enumerate() {
        if !matches!(&token.token, lexer::Token::Fn) {
            continue;
        }
        let Some(left_paren) = (index + 1..tokens.len())
            .find(|candidate| matches!(&tokens[*candidate].token, lexer::Token::LeftParen))
        else {
            continue;
        };
        let Some(right_paren) = (left_paren + 1..tokens.len())
            .find(|candidate| matches!(&tokens[*candidate].token, lexer::Token::RightParen))
        else {
            continue;
        };
        let Some(left_brace) = (right_paren + 1..tokens.len())
            .find(|candidate| matches!(&tokens[*candidate].token, lexer::Token::LeftBrace))
        else {
            continue;
        };
        let params = tokens[left_paren + 1..right_paren]
            .iter()
            .filter_map(|param| match &param.token {
                lexer::Token::Identifier(name) => Some(name.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        bindings.entry(left_brace).or_default().extend(params);
    }

    if let Some(statements) = scope_statements(text) {
        let mut for_scopes = Vec::new();
        collect_for_scopes(&statements, &mut for_scopes);
        for (name, iterable_end) in for_scopes {
            if let Some((left_brace, _)) = tokens.iter().enumerate().find(|(_, token)| {
                matches!(&token.token, lexer::Token::LeftBrace)
                    && token_is_after_location(token, iterable_end)
            }) {
                bindings.entry(left_brace).or_default().push(name);
            }
        }
    }
    bindings
}

fn binding_declaration_indexes(tokens: &[lexer::LocatedToken]) -> HashSet<usize> {
    let mut indexes = HashSet::new();
    for (index, token) in tokens.iter().enumerate() {
        match &token.token {
            lexer::Token::Let => {
                if let Some((offset, _)) = tokens[index + 1..]
                    .iter()
                    .enumerate()
                    .find(|(_, candidate)| matches!(&candidate.token, lexer::Token::Identifier(_)))
                {
                    indexes.insert(index + 1 + offset);
                }
            }
            lexer::Token::Fn => {
                let Some(left_paren) = (index + 1..tokens.len())
                    .find(|candidate| matches!(&tokens[*candidate].token, lexer::Token::LeftParen))
                else {
                    continue;
                };
                let Some(right_paren) = (left_paren + 1..tokens.len()).find(|candidate| {
                    matches!(&tokens[*candidate].token, lexer::Token::RightParen)
                }) else {
                    continue;
                };
                for (candidate, token) in tokens
                    .iter()
                    .enumerate()
                    .take(right_paren)
                    .skip(left_paren + 1)
                {
                    if matches!(&token.token, lexer::Token::Identifier(_)) {
                        indexes.insert(candidate);
                    }
                }
            }
            lexer::Token::For => {
                if let Some((offset, _)) = tokens[index + 1..]
                    .iter()
                    .enumerate()
                    .find(|(_, candidate)| matches!(&candidate.token, lexer::Token::Identifier(_)))
                {
                    indexes.insert(index + 1 + offset);
                }
            }
            _ => {}
        }
    }
    indexes
}

fn active_lexical_shadow(text: &str, name: &str, line: usize, character: usize) -> bool {
    let tokens = lexer::lex(text);
    let target_index = identifier_index_at_position(text, line, character);
    let declaration_indexes = binding_declaration_indexes(&tokens);
    if target_index.is_some_and(|index| declaration_indexes.contains(&index)) {
        return true;
    }

    let scope_bindings = function_scope_bindings(text, &tokens);
    let mut pending_lets = let_activations(text);
    let mut scopes = vec![HashSet::<String>::new()];
    for (index, token) in tokens.iter().enumerate() {
        let token_line = token.line.saturating_sub(1);
        let token_character = token_start_utf16(text, token);
        if token_line > line || (token_line == line && token_character > character) {
            break;
        }

        let current = SourceLocation::new(token.line, token.column);
        let mut activated = Vec::new();
        pending_lets.retain(|(declared, initializer_end)| {
            if (initializer_end.line, initializer_end.column) < (current.line, current.column) {
                activated.push(declared.clone());
                false
            } else {
                true
            }
        });
        if let Some(scope) = scopes.last_mut() {
            scope.extend(activated);
        }

        match &token.token {
            lexer::Token::LeftBrace => {
                let scope = scope_bindings
                    .get(&index)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .collect::<HashSet<_>>();
                scopes.push(scope);
            }
            lexer::Token::RightBrace if scopes.len() > 1 => {
                scopes.pop();
            }
            lexer::Token::RightBrace => {}
            _ => {}
        }
    }
    scopes.iter().rev().any(|scope| scope.contains(name))
}

fn export_location(uri: &str, text: &str, export: &ExportInfo) -> Value {
    json!({
        "uri": uri,
        "range": declaration_name_range(text, export.location, &export.name)
    })
}

fn definition(
    uri: &str,
    text: &str,
    documents: &HashMap<String, String>,
    line: usize,
    character: usize,
) -> Value {
    if let Some((namespace, member)) = member_at_position(text, line, character)
        && let Some(import) = namespace_import(text, &namespace)
    {
        if active_lexical_shadow(text, &namespace, line, character) {
            return Value::Null;
        }
        let Some(target_uri) = resolve_import_uri(uri, &import.path) else {
            return Value::Null;
        };
        let Some(target_text) = documents.get(&target_uri) else {
            return Value::Null;
        };
        let Some(export) = export_info(target_text, &member) else {
            return Value::Null;
        };
        return export_location(&target_uri, target_text, &export);
    }

    let Some(name) = identifier_at_position(text, line, character) else {
        return Value::Null;
    };
    if let Some(import) = named_import(text, &name) {
        if active_lexical_shadow(text, &name, line, character) {
            return Value::Null;
        }
        let Some(target_uri) = resolve_import_uri(uri, &import.path) else {
            return Value::Null;
        };
        let Some(target_text) = documents.get(&target_uri) else {
            return Value::Null;
        };
        let Some(export) = export_info(target_text, &import.exported) else {
            return Value::Null;
        };
        return export_location(&target_uri, target_text, &export);
    }

    if namespace_import(text, &name).is_some()
        && active_lexical_shadow(text, &name, line, character)
    {
        return Value::Null;
    }

    let Some((location, kind)) = top_level_symbol(text, &name) else {
        return Value::Null;
    };
    let range = if matches!(kind, "module namespace" | "imported binding") {
        source_range(text, location, &name)
    } else {
        declaration_range(location)
    };
    json!({"uri":uri,"range":range})
}

fn imported_hover(name: &str, target_uri: &str, export: &ExportInfo) -> Value {
    json!({"contents":{"kind":"markdown","value":format!(
        "`{name}`\n\nImported SolveLang {} `{}` from `{target_uri}`.",
        export.kind, export.name
    )}})
}

fn hover(
    uri: &str,
    text: &str,
    documents: &HashMap<String, String>,
    line: usize,
    character: usize,
) -> Value {
    if let Some((namespace, member)) = member_at_position(text, line, character)
        && let Some(import) = namespace_import(text, &namespace)
    {
        if active_lexical_shadow(text, &namespace, line, character) {
            return Value::Null;
        }
        let Some(target_uri) = resolve_import_uri(uri, &import.path) else {
            return Value::Null;
        };
        let Some(target_text) = documents.get(&target_uri) else {
            return Value::Null;
        };
        let Some(export) = export_info(target_text, &member) else {
            return Value::Null;
        };
        return imported_hover(&format!("{namespace}.{member}"), &target_uri, &export);
    }

    let Some(name) = identifier_at_position(text, line, character) else {
        return Value::Null;
    };
    if let Some(import) = named_import(text, &name) {
        if active_lexical_shadow(text, &name, line, character) {
            return Value::Null;
        }
        let Some(target_uri) = resolve_import_uri(uri, &import.path) else {
            return Value::Null;
        };
        let Some(target_text) = documents.get(&target_uri) else {
            return Value::Null;
        };
        let Some(export) = export_info(target_text, &import.exported) else {
            return Value::Null;
        };
        return imported_hover(&import.local, &target_uri, &export);
    }

    if namespace_import(text, &name).is_some()
        && active_lexical_shadow(text, &name, line, character)
    {
        return Value::Null;
    }

    let Some((_, kind)) = top_level_symbol(text, &name) else {
        return Value::Null;
    };
    json!({"contents":{"kind":"markdown","value":format!("`{name}`\n\nTop-level SolveLang {kind}.")}})
}

fn document_highlights(text: &str, line: usize, character: usize) -> Vec<Value> {
    let Some(name) = identifier_at_position(text, line, character) else {
        return Vec::new();
    };
    if top_level_symbol(text, &name).is_none() {
        return Vec::new();
    }
    lexer::lex(text)
        .into_iter()
        .filter_map(|located| match located.token {
            lexer::Token::Identifier(ref candidate) if candidate == &name => {
                let start = token_start_utf16(text, &located);
                Some(json!({
                    "range": {
                        "start": {"line": located.line.saturating_sub(1), "character": start},
                        "end": {"line": located.line.saturating_sub(1), "character": start + candidate.encode_utf16().count()}
                    },
                    "kind": 1
                }))
            }
            _ => None,
        })
        .collect()
}

fn completions(text: &str) -> Vec<Value> {
    let Some(statements) = parse_document(text) else {
        return Vec::new();
    };
    statements
        .into_iter()
        .flat_map(|statement| match statement {
            Stmt::Let { name, .. } => vec![json!({
                "label": name,
                "kind": 6,
                "detail": "Top-level SolveLang variable"
            })],
            Stmt::Function { name, params, .. } => vec![json!({
                "label": name,
                "kind": 3,
                "detail": format!("Top-level SolveLang function with {} parameter(s)", params.len())
            })],
            Stmt::Export {
                declaration: ExportedDeclaration::Let { name, .. },
                ..
            } => vec![json!({
                "label": name,
                "kind": 6,
                "detail": "Top-level SolveLang variable"
            })],
            Stmt::Export {
                declaration: ExportedDeclaration::Function { name, params, .. },
                ..
            } => vec![json!({
                "label": name,
                "kind": 3,
                "detail": format!("Top-level SolveLang function with {} parameter(s)", params.len())
            })],
            Stmt::ModuleImport { namespace, .. } => vec![json!({
                "label": namespace,
                "kind": 9,
                "detail": "Top-level SolveLang module namespace"
            })],
            Stmt::NamedModuleImport { bindings, .. } => bindings
                .into_iter()
                .map(|binding| {
                    json!({
                        "label": binding.local,
                        "kind": 6,
                        "detail": "Top-level SolveLang imported binding"
                    })
                })
                .collect(),
            Stmt::Agent { name, .. } => vec![json!({
                "label": name,
                "kind": 7,
                "detail": "Top-level SolveLang agent"
            })],
            _ => Vec::new(),
        })
        .collect()
}

fn module_completions(
    uri: &str,
    text: &str,
    documents: &HashMap<String, String>,
    line: usize,
    character: usize,
) -> Option<Vec<Value>> {
    let namespace = namespace_before_completion(text, line, character)?;
    let import = namespace_import(text, &namespace)?;
    if active_lexical_shadow(text, &namespace, line, character) {
        return Some(Vec::new());
    }
    let Some(target_uri) = resolve_import_uri(uri, &import.path) else {
        return Some(Vec::new());
    };
    let Some(target_text) = documents.get(&target_uri) else {
        return Some(Vec::new());
    };
    Some(
        export_infos(target_text)
            .into_iter()
            .map(|export| {
                let kind = if export.kind == "function" { 3 } else { 6 };
                let detail = if export.kind == "function" {
                    format!(
                        "Exported SolveLang function with {} parameter(s) from {}",
                        export.params, target_uri
                    )
                } else {
                    format!("Exported SolveLang variable from {}", target_uri)
                };
                json!({"label": export.name, "kind": kind, "detail": detail})
            })
            .collect(),
    )
}

fn utf16_character_at(text: &str, line: usize, column: usize) -> Option<usize> {
    text.lines().nth(line.saturating_sub(1)).map(|source_line| {
        source_line
            .chars()
            .take(column.saturating_sub(1))
            .map(char::len_utf16)
            .sum()
    })
}

fn semantic_token_kind_and_length(token: &lexer::Token) -> Option<(u32, usize)> {
    use lexer::Token;

    match token {
        Token::Let => Some((0, 3)),
        Token::Fn | Token::If | Token::In | Token::Or => Some((0, 2)),
        Token::For | Token::And | Token::Not | Token::Ask => Some((0, 3)),
        Token::Else | Token::Tool | Token::True => Some((0, 4)),
        Token::While | Token::Break | Token::Agent | Token::Print | Token::False => Some((0, 5)),
        Token::Return => Some((0, 6)),
        Token::Continue => Some((0, 8)),
        Token::Instruction => Some((0, 11)),
        Token::Identifier(name) => Some((1, name.encode_utf16().count())),
        Token::Number(number) => Some((2, number.to_string().encode_utf16().count())),
        Token::Plus
        | Token::Minus
        | Token::Star
        | Token::Slash
        | Token::Dot
        | Token::Colon
        | Token::Equal
        | Token::LeftParen
        | Token::RightParen
        | Token::LeftBrace
        | Token::RightBrace
        | Token::LeftBracket
        | Token::RightBracket
        | Token::Comma => Some((3, 1)),
        Token::Join
        | Token::EqualEqual
        | Token::BangEqual
        | Token::GreaterEqual
        | Token::LessEqual => Some((3, 2)),
        Token::Greater | Token::Less => Some((3, 1)),
        Token::Text(_)
        | Token::InvalidInteger(_)
        | Token::InvalidCharacter(_)
        | Token::Newline
        | Token::Eof => None,
    }
}

fn semantic_tokens(text: &str) -> Vec<u32> {
    if parse_document(text).is_none() {
        return Vec::new();
    }

    let mut encoded = Vec::new();
    let mut previous_line = 0;
    let mut previous_start = 0;
    for located in lexer::lex(text) {
        let Some((token_type, length)) = semantic_token_kind_and_length(&located.token) else {
            continue;
        };
        let line = located.line.saturating_sub(1);
        let Some(start) = utf16_character_at(text, located.line, located.column) else {
            continue;
        };
        let delta_line = line.saturating_sub(previous_line);
        let delta_start = if delta_line == 0 {
            start.saturating_sub(previous_start)
        } else {
            start
        };
        encoded.extend([
            delta_line as u32,
            delta_start as u32,
            length as u32,
            token_type,
            0,
        ]);
        previous_line = line;
        previous_start = start;
    }
    encoded
}

fn document_formatting(text: &str) -> Option<Vec<Value>> {
    parse_document(text)?;

    let formatted = formatter::format_source(text);
    if formatted == text {
        return Some(Vec::new());
    }

    let lines: Vec<&str> = text.split('\n').collect();
    let last_line = lines.len().saturating_sub(1);
    let last_character = lines[last_line].encode_utf16().count();
    Some(vec![json!({
        "range": {
            "start": {"line": 0, "character": 0},
            "end": {"line": last_line, "character": last_character}
        },
        "newText": formatted
    })])
}

fn process_message(message: Value, documents: &mut HashMap<String, String>) -> Vec<Value> {
    let method = message.get("method").and_then(Value::as_str);
    match method {
        Some("initialize") => vec![
            json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "result":{"capabilities":{"textDocumentSync":1,"documentSymbolProvider":true,"definitionProvider":true,"hoverProvider":true,"documentHighlightProvider":true,"completionProvider":{"triggerCharacters":["."]},"documentFormattingProvider":true,"semanticTokensProvider":{"legend":{"tokenTypes":["keyword","variable","number","operator"],"tokenModifiers":[]},"full":true}}}}),
        ],
        Some("shutdown") => vec![
            json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "result":null}),
        ],
        Some("textDocument/didOpen") => {
            let document = &message["params"]["textDocument"];
            let uri = document["uri"].as_str().unwrap_or("");
            let text = document["text"].as_str().unwrap_or("");
            documents.insert(uri.to_string(), text.to_string());
            vec![
                json!({"jsonrpc":"2.0", "method":"textDocument/publishDiagnostics", "params":{"uri":uri,"diagnostics":diagnostics(text)}}),
            ]
        }
        Some("textDocument/documentSymbol") => {
            let uri = message["params"]["textDocument"]["uri"]
                .as_str()
                .unwrap_or("");
            vec![
                json!({"jsonrpc":"2.0","id":message.get("id").cloned().unwrap_or(Value::Null),"result":documents.get(uri).map(|text| symbols(text)).unwrap_or_default()}),
            ]
        }
        Some("textDocument/definition") => {
            let uri = message["params"]["textDocument"]["uri"]
                .as_str()
                .unwrap_or("");
            let position = &message["params"]["position"];
            let result = documents
                .get(uri)
                .map(|text| {
                    definition(
                        uri,
                        text,
                        documents,
                        position["line"].as_u64().unwrap_or(0) as usize,
                        position["character"].as_u64().unwrap_or(0) as usize,
                    )
                })
                .unwrap_or(Value::Null);
            vec![
                json!({"jsonrpc":"2.0","id":message.get("id").cloned().unwrap_or(Value::Null),"result":result}),
            ]
        }
        Some("textDocument/hover") => {
            let uri = message["params"]["textDocument"]["uri"]
                .as_str()
                .unwrap_or("");
            let position = &message["params"]["position"];
            let result = documents
                .get(uri)
                .map(|text| {
                    hover(
                        uri,
                        text,
                        documents,
                        position["line"].as_u64().unwrap_or(0) as usize,
                        position["character"].as_u64().unwrap_or(0) as usize,
                    )
                })
                .unwrap_or(Value::Null);
            vec![
                json!({"jsonrpc":"2.0","id":message.get("id").cloned().unwrap_or(Value::Null),"result":result}),
            ]
        }
        Some("textDocument/documentHighlight") => {
            let uri = message["params"]["textDocument"]["uri"]
                .as_str()
                .unwrap_or("");
            let position = &message["params"]["position"];
            let result = documents
                .get(uri)
                .map(|text| {
                    document_highlights(
                        text,
                        position["line"].as_u64().unwrap_or(0) as usize,
                        position["character"].as_u64().unwrap_or(0) as usize,
                    )
                })
                .unwrap_or_default();
            vec![
                json!({"jsonrpc":"2.0","id":message.get("id").cloned().unwrap_or(Value::Null),"result":result}),
            ]
        }
        Some("textDocument/completion") => {
            let uri = message["params"]["textDocument"]["uri"]
                .as_str()
                .unwrap_or("");
            let position = &message["params"]["position"];
            let result = documents
                .get(uri)
                .map(|text| {
                    module_completions(
                        uri,
                        text,
                        documents,
                        position["line"].as_u64().unwrap_or(0) as usize,
                        position["character"].as_u64().unwrap_or(0) as usize,
                    )
                    .unwrap_or_else(|| completions(text))
                })
                .unwrap_or_default();
            vec![
                json!({"jsonrpc":"2.0","id":message.get("id").cloned().unwrap_or(Value::Null),"result":result}),
            ]
        }
        Some("textDocument/semanticTokens/full") => {
            let uri = message["params"]["textDocument"]["uri"]
                .as_str()
                .unwrap_or("");
            let result = documents
                .get(uri)
                .map(|text| json!({"data": semantic_tokens(text)}))
                .unwrap_or_else(|| json!({"data": []}));
            vec![
                json!({"jsonrpc":"2.0","id":message.get("id").cloned().unwrap_or(Value::Null),"result":result}),
            ]
        }
        Some("textDocument/formatting") => {
            let uri = message["params"]["textDocument"]["uri"]
                .as_str()
                .unwrap_or("");
            let result = documents
                .get(uri)
                .and_then(|text| document_formatting(text).map(Value::from))
                .unwrap_or(Value::Null);
            vec![
                json!({"jsonrpc":"2.0","id":message.get("id").cloned().unwrap_or(Value::Null),"result":result}),
            ]
        }
        _ => Vec::new(),
    }
}

fn write_message(output: &mut impl Write, value: &Value) -> io::Result<()> {
    let body = serde_json::to_vec(value).expect("serializable JSON-RPC response");
    write!(output, "Content-Length: {}\r\n\r\n", body.len())?;
    output.write_all(&body)
}

#[derive(Default)]
struct Server {
    documents: HashMap<String, String>,
    versions: HashMap<String, i64>,
}

fn bounded_document(text: &str) -> bool {
    if text.len() > 65_536 {
        return false;
    }
    let tokens = lexer::lex(text);
    if tokens.len() > 512 {
        return false;
    }
    let mut stack = Vec::new();
    for token in tokens {
        match token.token {
            lexer::Token::LeftParen | lexer::Token::LeftBrace | lexer::Token::LeftBracket => {
                stack.push(match token.token {
                    lexer::Token::LeftParen => b'(',
                    lexer::Token::LeftBrace => b'{',
                    _ => b'[',
                });
                if stack.len() > 64 {
                    return false;
                }
            }
            lexer::Token::RightParen | lexer::Token::RightBrace | lexer::Token::RightBracket => {
                let opening = match token.token {
                    lexer::Token::RightParen => b'(',
                    lexer::Token::RightBrace => b'{',
                    _ => b'[',
                };
                if stack.last() == Some(&opening) {
                    stack.pop();
                }
            }
            _ => {}
        }
    }
    true
}

fn local_document_uri(uri: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(uri) else {
        return false;
    };
    parsed.scheme() == "file"
        && parsed.host_str().is_none_or(|host| host == "localhost")
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && parsed.path().ends_with(".solve")
}

impl Server {
    fn process(&mut self, message: Value) -> Vec<Value> {
        let method = message["method"].as_str().unwrap_or("");
        if !matches!(
            method,
            "textDocument/didOpen" | "textDocument/didChange" | "textDocument/didClose"
        ) {
            return process_message(message, &mut self.documents);
        }
        let document = &message["params"]["textDocument"];
        let Some(uri) = document["uri"].as_str() else {
            return Vec::new();
        };
        if uri.len() > 4096
            || !local_document_uri(uri)
            || resolve_import_uri(uri, "entry.solve").is_none()
        {
            return Vec::new();
        }
        if method == "textDocument/didClose" {
            self.documents.remove(uri);
            self.versions.remove(uri);
            return vec![
                json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":uri,"diagnostics":[]}}),
            ];
        }
        let Some(version) = document["version"].as_i64() else {
            return Vec::new();
        };
        if method == "textDocument/didOpen" {
            if self.versions.contains_key(uri) || self.versions.len() >= 64 {
                return Vec::new();
            }
        } else if self
            .versions
            .get(uri)
            .is_none_or(|previous| version <= *previous)
        {
            return Vec::new();
        }
        self.versions.insert(uri.to_string(), version);
        let text = if method == "textDocument/didOpen" {
            document["text"].as_str()
        } else {
            message["params"]["contentChanges"]
                .as_array()
                .and_then(|changes| {
                    (changes.len() == 1
                        && changes[0].get("range").is_none()
                        && changes[0].get("rangeLength").is_none())
                    .then(|| changes[0]["text"].as_str())
                    .flatten()
                })
        };
        let diagnostics = if let Some(text) = text.filter(|text| bounded_document(text)) {
            self.documents.insert(uri.to_string(), text.to_string());
            diagnostics(text)
        } else {
            // Never answer later navigation requests using obsolete source.
            self.documents.remove(uri);
            vec![
                json!({"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"severity":2,"source":"solvec","message":"Document unavailable: require one full-text change within editor source/token/depth limits"}),
            ]
        };
        vec![
            json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":uri,"version":version,"diagnostics":diagnostics}}),
        ]
    }
}

fn main() -> io::Result<()> {
    let mut input = BufReader::new(io::stdin().lock());
    let mut output = io::stdout().lock();
    let mut server = Server::default();
    loop {
        let mut length = None;
        let mut header_bytes = 0;
        loop {
            let mut line = String::new();
            if input.by_ref().take(8193).read_line(&mut line)? == 0 {
                return Ok(());
            }
            header_bytes += line.len();
            if header_bytes > 8192 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "LSP header exceeds limit",
                ));
            }
            if line == "\r\n" || line == "\n" {
                break;
            }
            if let Some(value) = line.strip_prefix("Content-Length:") {
                length = value.trim().parse::<usize>().ok();
            }
        }
        let Some(length) = length else {
            continue;
        };
        if length > 1_048_576 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "LSP body exceeds limit",
            ));
        }
        let mut body = vec![0; length];
        input.read_exact(&mut body)?;
        let Ok(message) = serde_json::from_slice::<Value>(&body) else {
            continue;
        };
        for response in server.process(message) {
            write_message(&mut output, &response)?;
        }
        output.flush()?;
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn remote_and_non_file_document_uris_are_not_admitted() {
        let mut server = super::Server::default();
        for uri in [
            "https://example.com/main.solve",
            "vscode-remote://host/main.solve",
            "file://remote/main.solve",
            "file:///main.solve?query=x",
            "file:///main.solve#fragment",
        ] {
            assert!(server.process(json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":uri,"version":1,"text":"let x = 1"}}})).is_empty());
        }
        assert!(server.documents.is_empty());
        assert!(server.versions.is_empty());
    }
    #[test]
    fn full_text_changes_reject_stale_versions_and_close_clears_cache() {
        let mut server = super::Server::default();
        let uri = "file:///project/main.solve";
        server.process(json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":uri,"version":1,"text":"let before = 1"}}}));
        let change = |version, text| json!({"method":"textDocument/didChange","params":{"textDocument":{"uri":uri,"version":version},"contentChanges":[{"text":text}]}});
        let response = server.process(change(2, "let after = 2"));
        assert_eq!(response[0]["params"]["version"], 2);
        assert!(server.process(change(1, "let stale = 3")).is_empty());
        assert!(server.process(change(2, "let duplicate = 3")).is_empty());
        assert_eq!(server.documents[uri], "let after = 2");
        server.process(
            json!({"method":"textDocument/didClose","params":{"textDocument":{"uri":uri}}}),
        );
        assert!(!server.documents.contains_key(uri));
        assert!(server.process(change(3, "let closed = 4")).is_empty());
    }

    #[test]
    fn rejected_new_changes_invalidate_stale_source_and_bounds_are_enforced() {
        let mut server = super::Server::default();
        let uri = "file:///project/main.solve";
        server.process(json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":uri,"version":1,"text":"let old = 1"}}}));
        server.process(json!({"method":"textDocument/didChange","params":{"textDocument":{"uri":uri,"version":2},"contentChanges":[{"range":{},"text":"x"}]}}));
        assert!(!server.documents.contains_key(uri));
        assert!(!super::bounded_document(&"(".repeat(65)));
        assert!(!super::bounded_document(&format!(
            "{}{}{}1",
            "(".repeat(63),
            "] +".repeat(63),
            "(".repeat(63)
        )));
        assert!(!super::bounded_document(&"x".repeat(65_537)));
        for index in 0..65 {
            server.process(json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":format!("file:///project/{index}.solve"),"version":1,"text":"let x = 1"}}}));
        }
        assert!(server.versions.len() <= 64);
        assert!(server.documents.len() <= 64);
    }

    use super::{completions, process_message, symbols, top_level_symbol};
    use serde_json::json;
    use std::collections::HashMap;

    fn open(documents: &mut HashMap<String, String>, uri: &str, text: &str) {
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":uri,"text":text}}}),
            documents,
        );
    }

    #[test]
    fn initialize_advertises_full_document_sync_only() {
        let output = process_message(
            json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
            &mut HashMap::new(),
        );
        assert_eq!(output[0]["result"]["capabilities"]["textDocumentSync"], 1);
        assert_eq!(output[0]["result"]["capabilities"]["hoverProvider"], true);
        assert_eq!(
            output[0]["result"]["capabilities"]["completionProvider"]["triggerCharacters"],
            json!(["."])
        );
    }

    #[test]
    fn did_open_publishes_source_located_parser_diagnostics() {
        let output = process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":"let = 1"}}}),
            &mut HashMap::new(),
        );
        assert_eq!(output[0]["method"], "textDocument/publishDiagnostics");
        assert_eq!(output[0]["params"]["uri"], "file:///test.solve");
        assert!(
            !output[0]["params"]["diagnostics"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn exported_declarations_remain_visible_to_lsp_symbols_and_completion() {
        let source = "export let version = 1\nexport fn add(left, right) { return left + right }\n";
        assert_eq!(symbols(source).len(), 2);
        assert_eq!(top_level_symbol(source, "version").unwrap().1, "variable");
        assert_eq!(top_level_symbol(source, "add").unwrap().1, "function");
        assert_eq!(completions(source).len(), 2);
    }

    #[test]
    fn imports_remain_visible_to_lsp_symbols_and_completion() {
        let source = "import \"math.solve\" as math\nimport { version as api_version, add } from \"math.solve\"\n";
        assert_eq!(symbols(source).len(), 3);
        assert_eq!(
            top_level_symbol(source, "math").unwrap().1,
            "module namespace"
        );
        assert_eq!(
            top_level_symbol(source, "api_version").unwrap().1,
            "imported binding"
        );
        assert_eq!(
            top_level_symbol(source, "add").unwrap().1,
            "imported binding"
        );
        assert_eq!(completions(source).len(), 3);
    }

    #[test]
    fn definition_resolves_same_document_top_level_symbols() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///test.solve",
            "let item = 1\nprint(item)",
        );
        let output = process_message(
            json!({"id":3,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///test.solve"},"position":{"line":1,"character":6}}}),
            &mut documents,
        );
        assert_eq!(output[0]["result"]["uri"], "file:///test.solve");
    }

    #[test]
    fn namespace_member_definition_crosses_open_documents() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "export let version = 1\nexport fn add(left, right) { return left + right }\nlet private = 9\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import \"math.solve\" as math\nprint(math.version)\n",
        );
        let output = process_message(
            json!({"id":20,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":12}}}),
            &mut documents,
        );
        assert_eq!(output[0]["result"]["uri"], "file:///project/math.solve");
        assert_eq!(output[0]["result"]["range"]["start"]["line"], 0);
        assert_eq!(output[0]["result"]["range"]["start"]["character"], 11);
    }

    #[test]
    fn namespace_function_definition_crosses_open_documents() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "export fn add(left, right) { return left + right }\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import \"math.solve\" as math\nprint(math.add(1, 2))\n",
        );
        let output = process_message(
            json!({"id":21,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":11}}}),
            &mut documents,
        );
        assert_eq!(output[0]["result"]["uri"], "file:///project/math.solve");
    }

    #[test]
    fn namespace_alias_definition_stays_local() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/main.solve",
            "import \"math.solve\" as math\nprint(math)\n",
        );
        let output = process_message(
            json!({"id":22,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":6}}}),
            &mut documents,
        );
        assert_eq!(output[0]["result"]["uri"], "file:///project/main.solve");
    }

    #[test]
    fn named_and_aliased_imports_resolve_to_defining_export() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "export let version = 1\nexport fn add(left, right) { return left + right }\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import { version as api_version, add } from \"math.solve\"\nprint(api_version)\nprint(add(1, 2))\n",
        );
        let alias = process_message(
            json!({"id":23,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":7}}}),
            &mut documents,
        );
        assert_eq!(alias[0]["result"]["uri"], "file:///project/math.solve");
        assert_eq!(alias[0]["result"]["range"]["start"]["line"], 0);
        let direct = process_message(
            json!({"id":24,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":2,"character":6}}}),
            &mut documents,
        );
        assert_eq!(direct[0]["result"]["uri"], "file:///project/math.solve");
        assert_eq!(direct[0]["result"]["range"]["start"]["line"], 1);
    }

    #[test]
    fn namespace_completion_exposes_exports_only() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "export let version = 1\nexport fn add(left, right) { return left + right }\nlet private = 9\nfn hidden() {}\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import \"math.solve\" as math\nmath.",
        );
        let output = process_message(
            json!({"id":25,"method":"textDocument/completion","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":5}}}),
            &mut documents,
        );
        let items = output[0]["result"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["label"], "version");
        assert_eq!(items[1]["label"], "add");
    }

    #[test]
    fn unopened_module_targets_fail_closed() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/main.solve",
            "import { version } from \"math.solve\"\nprint(version)\n",
        );
        let output = process_message(
            json!({"id":26,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":7}}}),
            &mut documents,
        );
        assert!(output[0]["result"].is_null());
    }

    #[test]
    fn private_module_names_do_not_navigate() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "let private = 9\nexport let public = 1\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import \"math.solve\" as math\nprint(math.private)\n",
        );
        let output = process_message(
            json!({"id":27,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":12}}}),
            &mut documents,
        );
        assert!(output[0]["result"].is_null());
    }

    #[test]
    fn lexical_parameter_shadow_wins_over_named_import() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "export let value = 1\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import { value } from \"math.solve\"\nfn read(value) { return value }\nprint(read(9))\n",
        );
        let output = process_message(
            json!({"id":28,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":24}}}),
            &mut documents,
        );
        assert!(output[0]["result"].is_null());
    }

    #[test]
    fn let_initializer_still_resolves_import_before_shadow_activates() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/state.solve",
            "export let value = 1\n",
        );
        let source =
            "import \"state.solve\" as state\nfn read() { let state = state.value return state }\n";
        open(&mut documents, "file:///project/main.solve", source);
        let line = source.lines().nth(1).unwrap();
        let rhs = line.find("state.value").unwrap() + "state.".len();
        let initializer = process_message(
            json!({"id":38,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":rhs}}}),
            &mut documents,
        );
        assert_eq!(
            initializer[0]["result"]["uri"],
            "file:///project/state.solve"
        );

        let returned = line.rfind("state").unwrap();
        let after_initializer = process_message(
            json!({"id":39,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":returned}}}),
            &mut documents,
        );
        assert!(after_initializer[0]["result"].is_null());
    }

    #[test]
    fn lexical_namespace_shadow_blocks_module_member_navigation() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/state.solve",
            "export let value = 1\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import \"state.solve\" as state\nfn read(state) { return state.value }\nprint(read({ value: 9 }))\n",
        );
        let output = process_message(
            json!({"id":29,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":30}}}),
            &mut documents,
        );
        assert!(output[0]["result"].is_null());
    }

    #[test]
    fn cross_file_ranges_use_utf16_units() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "export let a𐐀 = 1\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import { a𐐀 } from \"math.solve\"\nprint(a𐐀)\n",
        );
        let output = process_message(
            json!({"id":30,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":7}}}),
            &mut documents,
        );
        let start = output[0]["result"]["range"]["start"]["character"]
            .as_u64()
            .unwrap();
        let end = output[0]["result"]["range"]["end"]["character"]
            .as_u64()
            .unwrap();
        assert_eq!(start, 11);
        assert_eq!(end - start, 3);
    }

    #[test]
    fn cross_file_hover_identifies_origin() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "export let version = 1\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import { version as api_version } from \"math.solve\"\nprint(api_version)\n",
        );
        let output = process_message(
            json!({"id":31,"method":"textDocument/hover","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":7}}}),
            &mut documents,
        );
        let value = output[0]["result"]["contents"]["value"].as_str().unwrap();
        assert!(value.contains("version"));
        assert!(value.contains("file:///project/math.solve"));
    }

    #[test]
    fn parent_traversal_import_uri_fails_closed() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/shared/math.solve",
            "export let version = 1\n",
        );
        open(
            &mut documents,
            "file:///project/app/main.solve",
            "import { version } from \"../shared/math.solve\"\nprint(version)\n",
        );
        let output = process_message(
            json!({"id":32,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/app/main.solve"},"position":{"line":1,"character":7}}}),
            &mut documents,
        );
        assert!(output[0]["result"].is_null());
    }

    #[test]
    fn encoded_module_uri_matches_decoded_import_path() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/my%20module.solve",
            "export let version = 1\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import { version } from \"my module.solve\"\nprint(version)\n",
        );
        let output = process_message(
            json!({"id":36,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":7}}}),
            &mut documents,
        );
        assert_eq!(
            output[0]["result"]["uri"],
            "file:///project/my%20module.solve"
        );
    }

    #[test]
    fn object_literal_iterable_keeps_loop_shadow_active_in_body() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/item.solve",
            "export let value = 99\n",
        );
        let source =
            "import \"item.solve\" as item\nfor item in [{ value: 1 }] { print(item.value) }\n";
        open(&mut documents, "file:///project/main.solve", source);
        let line = source.lines().nth(1).unwrap();
        let character = line.find("item.value").unwrap() + "item.".len();
        let output = process_message(
            json!({"id":37,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":character}}}),
            &mut documents,
        );
        assert!(output[0]["result"].is_null());
    }

    #[test]
    fn repeated_cross_file_responses_are_deterministic() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/math.solve",
            "export let version = 1\n",
        );
        open(
            &mut documents,
            "file:///project/main.solve",
            "import { version } from \"math.solve\"\nprint(version)\n",
        );
        let request = json!({"id":33,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":7}}});
        let first = process_message(request.clone(), &mut documents);
        let second = process_message(request, &mut documents);
        assert_eq!(first[0]["result"], second[0]["result"]);
    }

    #[test]
    fn formatting_rejects_invalid_or_unopened_documents() {
        let mut documents = HashMap::new();
        open(&mut documents, "file:///invalid.solve", "let = 1");
        let invalid = process_message(
            json!({"id":34,"method":"textDocument/formatting","params":{"textDocument":{"uri":"file:///invalid.solve"}}}),
            &mut documents,
        );
        assert!(invalid[0]["result"].is_null());
        let unopened = process_message(
            json!({"id":35,"method":"textDocument/formatting","params":{"textDocument":{"uri":"file:///missing.solve"}}}),
            &mut documents,
        );
        assert!(unopened[0]["result"].is_null());
    }
}
