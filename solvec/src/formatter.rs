#[derive(Clone, Debug, PartialEq, Eq)]
enum Piece {
    Word(String),
    String(String),
    Comment(String),
    Symbol(String),
    Newline,
}

/// Formats source without going through the AST. The parser deliberately drops
/// comments and decodes string escapes, so AST serialization would be lossy.
pub fn format_source(source: &str) -> String {
    let pieces = scan(source);
    let mut output = String::new();
    let mut line = String::new();
    let mut indent = 0usize;
    let mut brace_stack = Vec::new();

    let mut index = 0;
    while index < pieces.len() {
        match &pieces[index] {
            Piece::Newline => flush_line(&mut output, &mut line, indent),
            Piece::Comment(comment) => {
                if line.trim().is_empty() {
                    line.push_str(comment);
                } else {
                    trim_trailing_space(&mut line);
                    line.push_str("  ");
                    line.push_str(comment);
                }
                flush_line(&mut output, &mut line, indent);
            }
            Piece::Word(word) | Piece::String(word) => {
                if needs_space_before_word(&line) {
                    line.push(' ');
                }
                line.push_str(word);
            }
            Piece::Symbol(symbol) => match symbol.as_str() {
                "{" => {
                    let named_import = line.trim() == "import";
                    let inline_object = is_inline_object(&line) || named_import;
                    brace_stack.push(inline_object);
                    if inline_object {
                        trim_trailing_space(&mut line);
                        if named_import {
                            line.push(' ');
                        }
                        line.push('{');
                    } else {
                        if !line.trim().is_empty() && !line.ends_with(' ') {
                            line.push(' ');
                        }
                        line.push('{');
                        flush_line(&mut output, &mut line, indent);
                        indent += 1;
                    }
                }
                "}" => {
                    if brace_stack.pop().unwrap_or(false) {
                        trim_trailing_space(&mut line);
                        line.push('}');
                    } else {
                        flush_line(&mut output, &mut line, indent);
                        indent = indent.saturating_sub(1);
                        line.push('}');
                    }
                }
                "(" => {
                    trim_trailing_space(&mut line);
                    line.push_str(symbol);
                }
                "[" => line.push_str(symbol),
                ")" | "]" => {
                    trim_trailing_space(&mut line);
                    line.push_str(symbol);
                }
                "," => {
                    trim_trailing_space(&mut line);
                    line.push_str(", ");
                }
                ":" => {
                    trim_trailing_space(&mut line);
                    line.push_str(": ");
                }
                "." | ".." => {
                    trim_trailing_space(&mut line);
                    line.push_str(symbol);
                }
                "=" | "==" | "!=" | "+" | "-" | "*" | "/" | ">" | ">=" | "<" | "<=" => {
                    trim_trailing_space(&mut line);
                    if !line.is_empty() {
                        line.push(' ');
                    }
                    line.push_str(symbol);
                    line.push(' ');
                }
                _ => line.push_str(symbol),
            },
        }
        index += 1;
    }
    flush_line(&mut output, &mut line, indent);

    if output.is_empty() {
        String::new()
    } else {
        output
    }
}

fn scan(source: &str) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let mut chars = source.chars().peekable();

    while let Some(character) = chars.next() {
        match character {
            ' ' | '\t' | '\r' => {}
            '\n' => pieces.push(Piece::Newline),
            '/' if chars.peek() == Some(&'/') => {
                chars.next();
                let mut comment = String::from("//");
                let mut ended_by_newline = false;
                for next in chars.by_ref() {
                    if next == '\n' {
                        ended_by_newline = true;
                        break;
                    }
                    if next != '\r' {
                        comment.push(next);
                    }
                }
                pieces.push(Piece::Comment(comment));
                if ended_by_newline {
                    pieces.push(Piece::Newline);
                }
            }
            '"' => {
                let mut text = String::from("\"");
                let mut escaped = false;
                for next in chars.by_ref() {
                    text.push(next);
                    if escaped {
                        escaped = false;
                    } else if next == '\\' {
                        escaped = true;
                    } else if next == '"' {
                        break;
                    }
                }
                pieces.push(Piece::String(text));
            }
            character if character.is_ascii_alphanumeric() || character == '_' => {
                let mut word = character.to_string();
                while let Some(next) = chars.peek() {
                    if next.is_ascii_alphanumeric() || *next == '_' {
                        word.push(chars.next().expect("peeked character must be present"));
                    } else {
                        break;
                    }
                }
                pieces.push(Piece::Word(word));
            }
            character => {
                let mut symbol = character.to_string();
                if matches!(character, '.' | '=' | '!' | '>' | '<')
                    && let Some(next) = chars.peek()
                {
                    let pair = format!("{}{}", character, next);
                    if matches!(pair.as_str(), ".." | "==" | "!=" | ">=" | "<=") {
                        symbol.push(chars.next().expect("peeked character must be present"));
                    }
                }
                pieces.push(Piece::Symbol(symbol));
            }
        }
    }

    pieces
}

fn flush_line(output: &mut String, line: &mut String, indent: usize) {
    trim_trailing_space(line);
    if !line.is_empty() {
        output.push_str(&"    ".repeat(indent));
        output.push_str(line);
        line.clear();
    }
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }
}

fn trim_trailing_space(line: &mut String) {
    while line.ends_with(' ') {
        line.pop();
    }
}

fn needs_space_before_word(line: &str) -> bool {
    line.chars().last().is_some_and(|character| {
        character.is_ascii_alphanumeric()
            || character == '_'
            || character == '"'
            || character == '}'
    })
}

fn is_inline_object(line: &str) -> bool {
    let trimmed = line.trim_end();
    matches!(trimmed.chars().last(), Some('=' | '[' | '(' | ',' | ':'))
        || trimmed.ends_with("return")
}

#[cfg(test)]
mod tests {
    use super::format_source;
    use crate::{lexer, parser::Parser};

    #[test]
    fn formats_nested_language_and_is_idempotent() {
        let source = "fn add(a,b){\nif a>=b{print(\"a\\\\b\\\\n\"..a)}else{print(b)}\n}\n";
        let formatted = format_source(source);

        assert_eq!(
            formatted,
            "fn add(a, b) {\n    if a >= b {\n        print(\"a\\\\b\\\\n\"..a)\n    } else {\n        print(b)\n    }\n}\n"
        );
        assert_eq!(format_source(&formatted), formatted);
    }

    #[test]
    fn preserves_comments_and_normalizes_windows_newlines() {
        let formatted = format_source("// keep  spaces\r\nlet value= [1,2] // note\r\n");

        assert_eq!(formatted, "// keep  spaces\nlet value = [1, 2]  // note\n");
        assert!(!formatted.contains('\r'));
    }

    #[test]
    fn formats_agent_and_collection_syntax_without_reordering_values() {
        let formatted = format_source(
            "agent Helper{\ninstruction \"keep \\\"quotes\\\" and \\\\ slashes\"\ntool lookup\n}\nlet records=[{owner:\"A\",items:[1,2]}]\nfor record in records{print(record.owner)}\n",
        );

        assert_eq!(
            formatted,
            "agent Helper {\n    instruction \"keep \\\"quotes\\\" and \\\\ slashes\"\n    tool lookup\n}\nlet records = [{owner: \"A\", items: [1, 2]}]\nfor record in records {\n    print(record.owner)\n}\n"
        );
        assert_eq!(format_source(&formatted), formatted);
    }

    #[test]
    fn keeps_named_module_imports_on_a_parseable_line() {
        let formatted =
            format_source("import { add, api_version as version } from \"math.solve\"\n");

        assert_eq!(
            formatted,
            "import {add, api_version as version} from \"math.solve\"\n"
        );
        assert_eq!(format_source(&formatted), formatted);
        assert!(Parser::new(lexer::lex(&formatted)).parse().is_ok());
    }
}
