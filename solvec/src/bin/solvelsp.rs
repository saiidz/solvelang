//! Minimal stdio LSP transport for full-document diagnostics.
//!
//! Supported: initialize, shutdown, and textDocument/didOpen. URI updates,
//! incremental changes, workspace access, and execution are intentionally unsupported.

use serde_json::{Value, json};
use solvec::{
    ast::{ExportedDeclaration, SourceLocation, Stmt},
    formatter, lexer, parser,
};
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Read, Write};

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

fn symbols(text: &str) -> Vec<Value> {
    let mut parser = parser::Parser::new(lexer::lex(text));
    let Ok(statements) = parser.parse() else {
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

fn identifier_at_position(text: &str, line: usize, character: usize) -> Option<String> {
    lexer::lex(text)
        .into_iter()
        .find_map(|located| match located.token {
            lexer::Token::Identifier(name)
                if located.line == line + 1
                    && character + 1 >= located.column
                    && character < located.column + name.encode_utf16().count() =>
            {
                Some(name)
            }
            _ => None,
        })
}

fn top_level_symbol(text: &str, name: &str) -> Option<(SourceLocation, &'static str)> {
    let mut parser = parser::Parser::new(lexer::lex(text));
    let Ok(statements) = parser.parse() else {
        return None;
    };
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

fn definition(text: &str, line: usize, character: usize) -> Value {
    let Some(name) = identifier_at_position(text, line, character) else {
        return Value::Null;
    };
    let Some((location, kind)) = top_level_symbol(text, &name) else {
        return Value::Null;
    };
    let range = if matches!(kind, "module namespace" | "imported binding") {
        source_range(text, location, &name)
    } else {
        declaration_range(location)
    };
    json!({"uri":"","range":range})
}

fn hover(text: &str, line: usize, character: usize) -> Value {
    let Some(name) = identifier_at_position(text, line, character) else {
        return Value::Null;
    };
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
            lexer::Token::Identifier(candidate) if candidate == name => Some(json!({
                "range": {
                    "start": {"line": located.line.saturating_sub(1), "character": utf16_character_at(text, located.line, located.column).unwrap_or_else(|| located.column.saturating_sub(1))},
                    "end": {"line": located.line.saturating_sub(1), "character": utf16_character_at(text, located.line, located.column).unwrap_or_else(|| located.column.saturating_sub(1)) + candidate.encode_utf16().count()}
                },
                "kind": 1
            })),
            _ => None,
        })
        .collect()
}

fn completions(text: &str) -> Vec<Value> {
    let mut parser = parser::Parser::new(lexer::lex(text));
    let Ok(statements) = parser.parse() else {
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
    let mut parser = parser::Parser::new(lexer::lex(text));
    if parser.parse().is_err() {
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
    let mut parser = parser::Parser::new(lexer::lex(text));
    if parser.parse().is_err() {
        return None;
    }

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
            json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "result":{"capabilities":{"textDocumentSync":1,"documentSymbolProvider":true,"definitionProvider":true,"hoverProvider":true,"documentHighlightProvider":true,"completionProvider":{},"documentFormattingProvider":true,"semanticTokensProvider":{"legend":{"tokenTypes":["keyword","variable","number","operator"],"tokenModifiers":[]},"full":true}}}}),
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
            let mut result = documents
                .get(uri)
                .map(|text| {
                    definition(
                        text,
                        position["line"].as_u64().unwrap_or(0) as usize,
                        position["character"].as_u64().unwrap_or(0) as usize,
                    )
                })
                .unwrap_or(Value::Null);
            if let Some(location) = result.as_object_mut() {
                location.insert("uri".to_string(), Value::String(uri.to_string()));
            }
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
                        text,
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
            let result = documents
                .get(uri)
                .map(|text| completions(text))
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

fn main() -> io::Result<()> {
    let mut input = BufReader::new(io::stdin().lock());
    let mut output = io::stdout().lock();
    let mut documents = HashMap::new();
    loop {
        let mut length = None;
        loop {
            let mut line = String::new();
            if input.read_line(&mut line)? == 0 {
                return Ok(());
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
            continue;
        }
        let mut body = vec![0; length];
        input.read_exact(&mut body)?;
        let Ok(message) = serde_json::from_slice::<Value>(&body) else {
            continue;
        };
        for response in process_message(message, &mut documents) {
            write_message(&mut output, &response)?;
        }
        output.flush()?;
    }
}

#[cfg(test)]
mod tests {
    use super::{completions, process_message, symbols, top_level_symbol};
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn initialize_advertises_full_document_sync_only() {
        let output = process_message(
            json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
            &mut HashMap::new(),
        );
        assert_eq!(output[0]["result"]["capabilities"]["textDocumentSync"], 1);
        assert_eq!(output[0]["result"]["capabilities"]["hoverProvider"], true);
        assert_eq!(
            output[0]["result"]["capabilities"]["documentHighlightProvider"],
            true
        );
        assert!(output[0]["result"]["capabilities"]["completionProvider"].is_object());
        assert_eq!(
            output[0]["result"]["capabilities"]["documentFormattingProvider"],
            true
        );
        assert_eq!(
            output[0]["result"]["capabilities"]["semanticTokensProvider"]["legend"]["tokenTypes"],
            json!(["keyword", "variable", "number", "operator"])
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
        assert!(output[0]["params"]["diagnostics"].as_array().unwrap().len() > 0);
    }

    #[test]
    fn document_symbols_use_the_canonical_parser_for_open_documents() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":"let item = 1\nfn work() {}"}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":2,"method":"textDocument/documentSymbol","params":{"textDocument":{"uri":"file:///test.solve"}}}),
            &mut documents,
        );
        assert_eq!(output[0]["result"].as_array().unwrap().len(), 2);
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
    fn import_symbols_point_at_local_binding_tokens() {
        let source =
            "import \"math.solve\" as math\nimport { remote as local } from \"math.solve\"\n";
        assert_eq!(top_level_symbol(source, "math").unwrap().0.column, 24);
        assert_eq!(top_level_symbol(source, "local").unwrap().0.column, 20);
        let document_symbols = symbols(source);
        assert_eq!(
            document_symbols[0]["selectionRange"]["start"]["character"],
            23
        );
        assert_eq!(
            document_symbols[1]["selectionRange"]["start"]["character"],
            19
        );
    }

    #[test]
    fn import_ranges_use_utf16_offsets() {
        let source = "import \"😀.solve\" as math\nimport { a𐐀 as local } from \"math.solve\"\nprint(math)\n";
        let document_symbols = symbols(source);
        assert_eq!(
            document_symbols[0]["selectionRange"]["start"]["character"],
            21
        );
        assert_eq!(
            document_symbols[1]["selectionRange"]["start"]["character"],
            16
        );

        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":source}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":14,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///test.solve"},"position":{"line":2,"character":6}}}),
            &mut documents,
        );
        assert_eq!(output[0]["result"]["range"]["start"]["character"], 21);

        let highlights = process_message(
            json!({"id":15,"method":"textDocument/documentHighlight","params":{"textDocument":{"uri":"file:///test.solve"},"position":{"line":2,"character":6}}}),
            &mut documents,
        );
        assert_eq!(
            highlights[0]["result"][0]["range"]["start"]["character"],
            21
        );
    }

    #[test]
    fn definition_resolves_only_open_document_top_level_symbols() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":"let item = 1\nprint(item)"}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":3,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///test.solve"},"position":{"line":1,"character":6}}}),
            &mut documents,
        );
        assert_eq!(output[0]["result"]["uri"], "file:///test.solve");
    }

    #[test]
    fn hover_describes_open_document_top_level_symbols_only() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":"let item = 1\nprint(item)"}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":4,"method":"textDocument/hover","params":{"textDocument":{"uri":"file:///test.solve"},"position":{"line":1,"character":6}}}),
            &mut documents,
        );
        assert_eq!(output[0]["result"]["contents"]["kind"], "markdown");
        assert_eq!(
            output[0]["result"]["contents"]["value"],
            "`item`\n\nTop-level SolveLang variable."
        );

        let unopened = process_message(
            json!({"id":5,"method":"textDocument/hover","params":{"textDocument":{"uri":"file:///missing.solve"},"position":{"line":0,"character":0}}}),
            &mut documents,
        );
        assert!(unopened[0]["result"].is_null());
    }

    #[test]
    fn highlights_same_name_spans_for_open_document_top_level_symbols() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":"let item = 1\nprint(item)"}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":6,"method":"textDocument/documentHighlight","params":{"textDocument":{"uri":"file:///test.solve"},"position":{"line":1,"character":6}}}),
            &mut documents,
        );
        let highlights = output[0]["result"].as_array().expect("highlight list");
        assert_eq!(highlights.len(), 2);
        assert_eq!(highlights[0]["range"]["start"]["line"], 0);
        assert_eq!(highlights[1]["range"]["start"]["line"], 1);

        let unknown = process_message(
            json!({"id":7,"method":"textDocument/documentHighlight","params":{"textDocument":{"uri":"file:///test.solve"},"position":{"line":0,"character":0}}}),
            &mut documents,
        );
        assert!(unknown[0]["result"].as_array().unwrap().is_empty());
    }

    #[test]
    fn highlight_ranges_use_utf16_character_units() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///utf16.solve","text":"let café = 1\nprint(café)"}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":8,"method":"textDocument/documentHighlight","params":{"textDocument":{"uri":"file:///utf16.solve"},"position":{"line":1,"character":6}}}),
            &mut documents,
        );
        let highlights = output[0]["result"].as_array().expect("highlight list");
        assert_eq!(highlights.len(), 2);
        for highlight in highlights {
            let start = highlight["range"]["start"]["character"].as_u64().unwrap();
            let end = highlight["range"]["end"]["character"].as_u64().unwrap();
            assert_eq!(end - start, 4);
        }
    }

    #[test]
    fn completion_returns_parser_backed_top_level_symbols_from_open_documents() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":"let item = 1\nfn work(value) {}\nagent helper { instruction \"Assist\" }"}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":9,"method":"textDocument/completion","params":{"textDocument":{"uri":"file:///test.solve"},"position":{"line":3,"character":0}}}),
            &mut documents,
        );
        let items = output[0]["result"].as_array().expect("completion items");
        assert_eq!(items.len(), 3);
        assert_eq!(items[0]["label"], "item");
        assert_eq!(
            items[1]["detail"],
            "Top-level SolveLang function with 1 parameter(s)"
        );
        assert_eq!(items[2]["kind"], 7);

        let unopened = process_message(
            json!({"id":10,"method":"textDocument/completion","params":{"textDocument":{"uri":"file:///missing.solve"},"position":{"line":0,"character":0}}}),
            &mut documents,
        );
        assert!(unopened[0]["result"].as_array().unwrap().is_empty());
    }

    #[test]
    fn semantic_tokens_are_parser_validated_and_open_document_local() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":"let item = 1\nprint(item + 2)"}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":11,"method":"textDocument/semanticTokens/full","params":{"textDocument":{"uri":"file:///test.solve"}}}),
            &mut documents,
        );
        assert_eq!(
            output[0]["result"]["data"],
            json!([
                0, 0, 3, 0, 0, 0, 4, 4, 1, 0, 0, 5, 1, 3, 0, 0, 2, 1, 2, 0, 1, 0, 5, 0, 0, 0, 5, 1,
                3, 0, 0, 1, 4, 1, 0, 0, 5, 1, 3, 0, 0, 2, 1, 2, 0, 0, 1, 1, 3, 0
            ])
        );

        let unopened = process_message(
            json!({"id":12,"method":"textDocument/semanticTokens/full","params":{"textDocument":{"uri":"file:///missing.solve"}}}),
            &mut documents,
        );
        assert_eq!(unopened[0]["result"]["data"], json!([]));
    }

    #[test]
    fn formatting_uses_the_canonical_formatter_for_parser_valid_open_documents() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///test.solve","text":"// 😀\nlet value=1"}}}),
            &mut documents,
        );
        let output = process_message(
            json!({"id":13,"method":"textDocument/formatting","params":{"textDocument":{"uri":"file:///test.solve"}}}),
            &mut documents,
        );

        assert_eq!(output[0]["result"][0]["newText"], "// 😀\nlet value = 1\n");
        assert_eq!(
            output[0]["result"][0]["range"]["start"],
            json!({"line": 0, "character": 0})
        );
        assert_eq!(
            output[0]["result"][0]["range"]["end"],
            json!({"line": 1, "character": 11})
        );
    }

    #[test]
    fn formatting_rejects_invalid_or_unopened_documents() {
        let mut documents = HashMap::new();
        process_message(
            json!({"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///invalid.solve","text":"let = 1"}}}),
            &mut documents,
        );

        let invalid = process_message(
            json!({"id":14,"method":"textDocument/formatting","params":{"textDocument":{"uri":"file:///invalid.solve"}}}),
            &mut documents,
        );
        assert!(invalid[0]["result"].is_null());

        let unopened = process_message(
            json!({"id":15,"method":"textDocument/formatting","params":{"textDocument":{"uri":"file:///missing.solve"}}}),
            &mut documents,
        );
        assert!(unopened[0]["result"].is_null());
    }
}
