//! Minimal stdio LSP transport for full-document diagnostics.
//!
//! Supported: initialize, shutdown, and textDocument/didOpen. URI updates,
//! incremental changes, workspace access, and execution are intentionally unsupported.

use serde_json::{Value, json};
use solvec::{ast::Stmt, lexer, parser};
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
    statements.into_iter().filter_map(|statement| match statement {
        Stmt::Let { name, location, .. } => Some(json!({"name":name,"kind":13,"range":{"start":{"line":location.line.saturating_sub(1),"character":location.column.saturating_sub(1)},"end":{"line":location.line.saturating_sub(1),"character":location.column}},"selectionRange":{"start":{"line":location.line.saturating_sub(1),"character":location.column.saturating_sub(1)},"end":{"line":location.line.saturating_sub(1),"character":location.column}}})),
        Stmt::Function { name, location, .. } => Some(json!({"name":name,"kind":12,"range":{"start":{"line":location.line.saturating_sub(1),"character":location.column.saturating_sub(1)},"end":{"line":location.line.saturating_sub(1),"character":location.column}},"selectionRange":{"start":{"line":location.line.saturating_sub(1),"character":location.column.saturating_sub(1)},"end":{"line":location.line.saturating_sub(1),"character":location.column}}})),
        Stmt::Agent { name, location, .. } => Some(json!({"name":name,"kind":5,"range":{"start":{"line":location.line.saturating_sub(1),"character":location.column.saturating_sub(1)},"end":{"line":location.line.saturating_sub(1),"character":location.column}},"selectionRange":{"start":{"line":location.line.saturating_sub(1),"character":location.column.saturating_sub(1)},"end":{"line":location.line.saturating_sub(1),"character":location.column}}})),
        _ => None,
    }).collect()
}

fn process_message(message: Value, documents: &mut HashMap<String, String>) -> Vec<Value> {
    let method = message.get("method").and_then(Value::as_str);
    match method {
        Some("initialize") => vec![
            json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "result":{"capabilities":{"textDocumentSync":1,"documentSymbolProvider":true}}}),
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
    use super::process_message;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn initialize_advertises_full_document_sync_only() {
        let output = process_message(
            json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
            &mut HashMap::new(),
        );
        assert_eq!(output[0]["result"]["capabilities"]["textDocumentSync"], 1);
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
}
