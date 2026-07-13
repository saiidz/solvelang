#[derive(Clone, Debug, PartialEq)]
pub struct Diagnostic {
    pub line: usize,
    pub column: usize,
    pub message: String,
    pub hint: String,
}

impl Diagnostic {
    pub fn new(
        line: usize,
        column: usize,
        message: impl Into<String>,
        hint: impl Into<String>,
    ) -> Self {
        Self {
            line,
            column,
            message: message.into(),
            hint: hint.into(),
        }
    }

    pub fn format(&self, source_line: &str) -> String {
        let pointer_padding = " ".repeat(self.column.saturating_sub(1));
        format!(
            "SolveLang Error on line {}, column {}:\n{}\n{}\n{}^\nHint: {}",
            self.line, self.column, self.message, source_line, pointer_padding, self.hint
        )
    }
}

pub fn validate_source(source: &str) -> Result<(), Vec<Diagnostic>> {
    let mut diagnostics = Vec::new();
    let mut brace_stack: Vec<(usize, usize)> = Vec::new();

    for (line_index, line) in source.lines().enumerate() {
        let line_number = line_index + 1;
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with("//") {
            continue;
        }

        check_quotes(line, line_number, &mut diagnostics);
        check_braces(line, line_number, &mut brace_stack, &mut diagnostics);
    }

    for (line, column) in brace_stack {
        diagnostics.push(Diagnostic::new(
            line,
            column,
            "Unclosed block: missing '}' for this '{'.",
            "Add a matching closing brace '}' after the block body.",
        ));
    }

    if diagnostics.is_empty() {
        Ok(())
    } else {
        Err(diagnostics)
    }
}

fn check_quotes(line: &str, line_number: usize, diagnostics: &mut Vec<Diagnostic>) {
    let quote_count = line.chars().filter(|character| *character == '"').count();

    if quote_count % 2 != 0 {
        let column = line.find('"').map(|index| index + 1).unwrap_or(1);
        diagnostics.push(Diagnostic::new(
            line_number,
            column,
            "Unclosed string literal.",
            "Add a closing double quote before the end of the line.",
        ));
    }
}

fn check_braces(
    line: &str,
    line_number: usize,
    brace_stack: &mut Vec<(usize, usize)>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    for (index, character) in line.chars().enumerate() {
        match character {
            '{' => brace_stack.push((line_number, index + 1)),
            '}' if brace_stack.pop().is_none() => {
                diagnostics.push(Diagnostic::new(
                    line_number,
                    index + 1,
                    "Unexpected closing brace '}'.",
                    "Remove this brace or add a matching opening brace '{' before it.",
                ));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Diagnostic;

    #[test]
    fn formats_diagnostics_with_source_pointer_and_hint() {
        let diagnostic = Diagnostic::new(2, 7, "Expected expression.", "Add a value here.");
        let formatted = diagnostic.format("print()");

        assert!(formatted.contains("SolveLang Error on line 2, column 7"));
        assert!(formatted.contains("print()"));
        assert!(formatted.lines().any(|line| line.trim() == "^"));
        assert!(formatted.contains("Hint: Add a value here."));
    }
}
