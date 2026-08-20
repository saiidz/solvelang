use std::collections::BTreeMap;

use crate::ast::{BinaryOp, Expr, ExprKind, SourceLocation, Stmt, UnaryOp};
use crate::diagnostics::Diagnostic;
use crate::lexer::{LocatedToken, Token};

pub struct Parser {
    tokens: Vec<LocatedToken>,
    current: usize,
    errors: Vec<Diagnostic>,
}

impl Parser {
    pub fn new(tokens: Vec<LocatedToken>) -> Self {
        Self {
            tokens,
            current: 0,
            errors: Vec::new(),
        }
    }

    pub fn parse(&mut self) -> Result<Vec<Stmt>, Vec<Diagnostic>> {
        let mut statements = Vec::new();

        while !self.is_at_end() {
            self.skip_newlines();
            if self.is_at_end() {
                break;
            }

            let errors_before = self.errors.len();
            if let Some(statement) = self.statement() {
                if self.errors.len() == errors_before {
                    statements.push(statement);
                } else {
                    self.synchronize_statement();
                }
            } else {
                self.synchronize_statement();
            }
        }

        if self.errors.is_empty() {
            Ok(statements)
        } else {
            Err(self.errors.clone())
        }
    }

    fn statement(&mut self) -> Option<Stmt> {
        match self.peek() {
            Token::Let => self.let_statement(),
            Token::Print => self.print_statement(),
            Token::Return => self.return_statement(),
            Token::Fn => self.function_statement(),
            Token::If => self.if_statement(),
            Token::While => self.while_statement(),
            Token::For => self.for_statement(),
            Token::Agent => self.agent_statement(),
            Token::Ask => self.ask_statement(),
            Token::Identifier(_) if self.check_next(&Token::Equal) => self.assignment_statement(),
            _ => Some(Stmt::Expr(self.expression())),
        }
    }

    fn let_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        let name = self.consume_identifier("Expected variable name after 'let'.")?;
        if !self.consume(
            &Token::Equal,
            "Invalid variable declaration: expected '='.",
            "Use syntax like: let name = value",
        ) {
            return None;
        }
        let value = self.expression();
        Some(Stmt::Let {
            name,
            value,
            location,
        })
    }

    fn assignment_statement(&mut self) -> Option<Stmt> {
        let location = self.location();
        let name = self.consume_identifier("Expected variable name before '='.")?;
        if !self.consume(
            &Token::Equal,
            "Invalid assignment: expected '='.",
            "Use syntax like: name = value",
        ) {
            return None;
        }
        let value = self.expression();
        Some(Stmt::Assign {
            name,
            value,
            location,
        })
    }

    fn print_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        if !self.consume(
            &Token::LeftParen,
            "Invalid print statement: expected '('.",
            "Use syntax like: print(value)",
        ) {
            return None;
        }
        let errors_before = self.errors.len();
        let value = self.expression();
        if self.errors.len() == errors_before {
            self.consume(
                &Token::RightParen,
                "Invalid print statement: expected ')'.",
                "Close the print call with ')'.",
            );
        }
        Some(Stmt::Print { value, location })
    }

    fn return_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        Some(Stmt::Return {
            value: self.expression(),
            location,
        })
    }

    fn function_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        let name = self.consume_identifier("Expected function name after 'fn'.")?;
        let params = self.parameter_list()?;
        let body = self.block()?;
        Some(Stmt::Function {
            name,
            params,
            body,
            location,
        })
    }

    fn if_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        let condition = self.expression();
        let then_branch = self.block()?;
        self.skip_newlines();
        let else_branch = if self.matches(&Token::Else) {
            self.block()?
        } else {
            Vec::new()
        };
        Some(Stmt::If {
            condition,
            then_branch,
            else_branch,
            location,
        })
    }

    fn while_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        let condition = self.expression();
        let body = self.block()?;
        Some(Stmt::While {
            condition,
            body,
            location,
        })
    }

    fn for_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        let name = self.consume_identifier("Expected loop variable name after 'for'.")?;
        if !self.consume(
            &Token::In,
            "Invalid for loop: expected 'in' after loop variable.",
            "Use syntax like: for item in items { ... }",
        ) {
            return None;
        }
        let iterable = self.expression();
        let body = self.block()?;
        Some(Stmt::For {
            name,
            iterable,
            body,
            location,
        })
    }

    fn agent_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        let name = self.consume_identifier("Expected agent name after 'agent'.")?;
        if !self.consume(
            &Token::LeftBrace,
            "Invalid agent declaration: missing opening '{'.",
            "Use syntax like: agent SupportBot {",
        ) {
            return None;
        }
        self.skip_newlines();
        let mut instruction = String::new();
        let mut tools = Vec::new();

        while !self.check(&Token::RightBrace) && !self.is_at_end() {
            self.skip_newlines();
            if self.matches(&Token::Instruction) {
                match self.advance() {
                    Token::Text(value) => instruction = value,
                    _ => self.error_previous(
                        "Invalid agent instruction: expected quoted text.",
                        "Use syntax like: instruction \"Answer clearly.\"",
                    ),
                }
            } else if self.matches(&Token::Tool) {
                if let Some(tool) = self.consume_identifier("Expected tool name after 'tool'.") {
                    tools.push(tool);
                }
            } else {
                self.error_here(
                    "Invalid agent declaration entry.",
                    "Use instruction \"...\" or tool name inside the agent block.",
                );
                self.synchronize_statement();
            }
            self.skip_newlines();
        }

        if !self.consume(
            &Token::RightBrace,
            "Unclosed agent block: missing '}'.",
            "Add a matching closing brace after the agent body.",
        ) {
            return None;
        }
        Some(Stmt::Agent {
            name,
            instruction,
            tools,
            location,
        })
    }

    fn ask_statement(&mut self) -> Option<Stmt> {
        let location = self.advance_location();
        let agent = self.consume_identifier("Expected agent name after 'ask'.")?;
        if !self.consume(
            &Token::LeftParen,
            "Invalid ask statement: expected '('.",
            "Use syntax like: ask SupportBot(\"message\")",
        ) {
            return None;
        }
        let errors_before = self.errors.len();
        let message = self.expression();
        if self.errors.len() == errors_before {
            self.consume(
                &Token::RightParen,
                "Invalid ask statement: expected ')'.",
                "Close the ask call with ')'.",
            );
        }
        Some(Stmt::Ask {
            agent,
            message,
            location,
        })
    }

    fn block(&mut self) -> Option<Vec<Stmt>> {
        if !self.consume(
            &Token::LeftBrace,
            "Invalid block: missing opening '{'.",
            "Add '{' before the block body.",
        ) {
            return None;
        }
        self.skip_newlines();
        let mut statements = Vec::new();

        while !self.check(&Token::RightBrace) && !self.is_at_end() {
            self.skip_newlines();
            if self.check(&Token::RightBrace) || self.is_at_end() {
                break;
            }
            let errors_before = self.errors.len();
            if let Some(statement) = self.statement() {
                if self.errors.len() == errors_before {
                    statements.push(statement);
                } else {
                    self.synchronize_statement();
                }
            } else {
                self.synchronize_statement();
            }
        }

        if !self.consume(
            &Token::RightBrace,
            "Unclosed block: missing '}'.",
            "Add a matching closing brace after the block body.",
        ) {
            return None;
        }
        Some(statements)
    }

    fn parameter_list(&mut self) -> Option<Vec<String>> {
        if !self.consume(
            &Token::LeftParen,
            "Invalid function declaration: expected parameter list.",
            "Use syntax like: fn name(arg) {",
        ) {
            return None;
        }
        let mut params = Vec::new();
        while !self.check(&Token::RightParen) && !self.is_at_end() {
            params.push(self.consume_identifier("Expected parameter name.")?);
            if !self.matches(&Token::Comma) {
                break;
            }
        }
        if self.consume(
            &Token::RightParen,
            "Invalid function declaration: expected ')'.",
            "Close the parameter list with ')'.",
        ) {
            Some(params)
        } else {
            None
        }
    }

    fn argument_list(&mut self) -> Vec<Expr> {
        let mut args = Vec::new();
        while !self.check(&Token::RightParen) && !self.is_at_end() {
            args.push(self.expression());
            if !self.matches(&Token::Comma) {
                break;
            }
        }
        args
    }

    fn expression(&mut self) -> Expr {
        self.or()
    }

    fn or(&mut self) -> Expr {
        self.binary_chain(Self::and, &[Token::Or], |token| match token {
            Token::Or => BinaryOp::Or,
            _ => unreachable!(),
        })
    }
    fn and(&mut self) -> Expr {
        self.binary_chain(Self::equality, &[Token::And], |token| match token {
            Token::And => BinaryOp::And,
            _ => unreachable!(),
        })
    }
    fn equality(&mut self) -> Expr {
        self.binary_chain(
            Self::comparison,
            &[Token::EqualEqual, Token::BangEqual],
            |token| match token {
                Token::EqualEqual => BinaryOp::Equal,
                Token::BangEqual => BinaryOp::NotEqual,
                _ => unreachable!(),
            },
        )
    }
    fn comparison(&mut self) -> Expr {
        self.binary_chain(
            Self::term,
            &[
                Token::Greater,
                Token::GreaterEqual,
                Token::Less,
                Token::LessEqual,
            ],
            |token| match token {
                Token::Greater => BinaryOp::Greater,
                Token::GreaterEqual => BinaryOp::GreaterEqual,
                Token::Less => BinaryOp::Less,
                Token::LessEqual => BinaryOp::LessEqual,
                _ => unreachable!(),
            },
        )
    }
    fn term(&mut self) -> Expr {
        self.binary_chain(
            Self::factor,
            &[Token::Plus, Token::Minus, Token::Join],
            |token| match token {
                Token::Plus => BinaryOp::Add,
                Token::Minus => BinaryOp::Subtract,
                Token::Join => BinaryOp::Join,
                _ => unreachable!(),
            },
        )
    }
    fn factor(&mut self) -> Expr {
        self.binary_chain(
            Self::unary,
            &[Token::Star, Token::Slash],
            |token| match token {
                Token::Star => BinaryOp::Multiply,
                Token::Slash => BinaryOp::Divide,
                _ => unreachable!(),
            },
        )
    }

    fn binary_chain(
        &mut self,
        next: fn(&mut Self) -> Expr,
        operators: &[Token],
        map: fn(&Token) -> BinaryOp,
    ) -> Expr {
        let mut expr = next(self);
        while operators.iter().any(|operator| self.check(operator)) {
            let token = self.advance_located();
            let right = next(self);
            expr = Expr::new(
                ExprKind::Binary {
                    left: Box::new(expr),
                    operator: map(&token.token),
                    right: Box::new(right),
                },
                SourceLocation::new(token.line, token.column),
            );
        }
        expr
    }

    fn unary(&mut self) -> Expr {
        if self.check(&Token::Not) {
            let location = self.advance_location();
            return Expr::new(
                ExprKind::Unary {
                    operator: UnaryOp::Not,
                    expr: Box::new(self.unary()),
                },
                location,
            );
        }
        self.postfix()
    }

    fn postfix(&mut self) -> Expr {
        let mut expr = self.primary();
        loop {
            if self.matches(&Token::LeftBracket) {
                let index = self.expression();
                self.consume(
                    &Token::RightBracket,
                    "Invalid index expression: expected ']'.",
                    "Close the index expression with ']'.",
                );
                let location = index.location;
                expr = Expr::new(ExprKind::Index(Box::new(expr), Box::new(index)), location);
            } else if self.matches(&Token::Dot) {
                let location = self.location();
                let name = self.consume_identifier("Expected property name after '.'.");
                if let Some(name) = name {
                    expr = Expr::new(ExprKind::Property(Box::new(expr), name), location);
                }
            } else {
                break;
            }
        }
        expr
    }

    fn primary(&mut self) -> Expr {
        if self.check(&Token::Newline) {
            let location = self.location();
            self.error_at(
                location,
                "Expected expression.",
                "Add a number, string, boolean, variable, array, object, or function call here.",
            );
            return Expr::new(ExprKind::Text(String::new()), location);
        }
        let token = self.advance_located();
        let location = SourceLocation::new(token.line, token.column);
        match token.token {
            Token::Number(value) => Expr::new(ExprKind::Number(value), location),
            Token::InvalidInteger(literal) => {
                self.error_at(
                    location,
                    &format!(
                        "Integer literal '{}' is outside the signed 32-bit integer range.",
                        literal
                    ),
                    "Use an integer from -2147483648 through 2147483647.",
                );
                Expr::new(ExprKind::Number(0), location)
            }
            Token::InvalidCharacter(character) => {
                self.error_at(
                    location,
                    &format!("unknown character '{}'.", character),
                    "Remove the character or replace it with valid SolveLang punctuation.",
                );
                Expr::new(ExprKind::Text(String::new()), location)
            }
            Token::Text(value) => Expr::new(ExprKind::Text(value), location),
            Token::True => Expr::new(ExprKind::Bool(true), location),
            Token::False => Expr::new(ExprKind::Bool(false), location),
            Token::Identifier(name) => {
                if self.matches(&Token::LeftParen) {
                    let args = self.argument_list();
                    self.consume(
                        &Token::RightParen,
                        "Invalid function call: expected ')'.",
                        "Close the function call with ')'.",
                    );
                    Expr::new(ExprKind::Call { name, args }, location)
                } else {
                    Expr::new(ExprKind::Variable(name), location)
                }
            }
            Token::LeftParen => {
                let expr = self.expression();
                self.consume(
                    &Token::RightParen,
                    "Invalid grouped expression: expected ')'.",
                    "Close the grouped expression with ')'.",
                );
                expr
            }
            Token::LeftBracket => {
                let mut values = Vec::new();
                while !self.check(&Token::RightBracket) && !self.is_at_end() {
                    values.push(self.expression());
                    if !self.matches(&Token::Comma) {
                        break;
                    }
                }
                self.consume(
                    &Token::RightBracket,
                    "Invalid array literal: expected ']'.",
                    "Close the array literal with ']'.",
                );
                Expr::new(ExprKind::Array(values), location)
            }
            Token::LeftBrace => self.object_literal(location),
            Token::Newline
            | Token::RightParen
            | Token::RightBrace
            | Token::RightBracket
            | Token::Comma
            | Token::Colon
            | Token::Dot
            | Token::Eof => {
                self.error_at(location, "Expected expression.", "Add a number, string, boolean, variable, array, object, or function call here.");
                Expr::new(ExprKind::Text(String::new()), location)
            }
            other => {
                self.error_at(
                    location,
                    &format!("Unexpected token in expression: {:?}", other),
                    "Try a number, string, boolean, variable, array, object, or function call.",
                );
                Expr::new(ExprKind::Text(String::new()), location)
            }
        }
    }

    fn object_literal(&mut self, location: SourceLocation) -> Expr {
        let mut entries = BTreeMap::new();
        self.skip_newlines();
        while !self.check(&Token::RightBrace) && !self.is_at_end() {
            let key = match self.advance() {
                Token::Identifier(name) | Token::Text(name) => name,
                _ => {
                    self.error_previous(
                        "Invalid object key.",
                        "Use an identifier or quoted string before ':'.",
                    );
                    return Expr::new(ExprKind::Object(entries), location);
                }
            };
            if !self.consume(
                &Token::Colon,
                "Invalid object entry: expected ':'.",
                "Use syntax like: { name: value }",
            ) {
                break;
            }
            let value = self.expression();
            entries.insert(key, value);
            self.skip_newlines();
            if self.matches(&Token::Comma) {
                self.skip_newlines();
            } else {
                break;
            }
        }
        self.skip_newlines();
        self.consume(
            &Token::RightBrace,
            "Invalid object literal: expected '}'.",
            "Close the object literal with '}'.",
        );
        Expr::new(ExprKind::Object(entries), location)
    }

    fn synchronize_statement(&mut self) {
        while !self.is_at_end() && !self.check(&Token::Newline) && !self.check(&Token::RightBrace) {
            self.advance();
        }
        self.skip_newlines();
    }

    fn matches(&mut self, expected: &Token) -> bool {
        if self.check(expected) {
            self.advance();
            true
        } else {
            false
        }
    }
    fn consume(&mut self, expected: &Token, message: &str, hint: &str) -> bool {
        if self.matches(expected) {
            true
        } else {
            self.error_here(message, hint);
            false
        }
    }
    fn consume_identifier(&mut self, message: &str) -> Option<String> {
        match self.advance() {
            Token::Identifier(name) => Some(name),
            _ => {
                self.error_previous(message, "Use a valid identifier name here.");
                None
            }
        }
    }
    fn skip_newlines(&mut self) {
        while self.check(&Token::Newline) {
            self.advance();
        }
    }
    fn check(&self, expected: &Token) -> bool {
        std::mem::discriminant(self.peek()) == std::mem::discriminant(expected)
    }
    fn check_next(&self, expected: &Token) -> bool {
        self.current + 1 < self.tokens.len()
            && std::mem::discriminant(&self.tokens[self.current + 1].token)
                == std::mem::discriminant(expected)
    }
    fn advance(&mut self) -> Token {
        self.advance_located().token
    }
    fn advance_located(&mut self) -> LocatedToken {
        let token = self.tokens[self.current].clone();
        if !matches!(token.token, Token::Eof) {
            self.current += 1;
        }
        token
    }
    fn advance_location(&mut self) -> SourceLocation {
        let token = self.advance_located();
        SourceLocation::new(token.line, token.column)
    }
    fn is_at_end(&self) -> bool {
        matches!(self.peek(), Token::Eof)
    }
    fn peek(&self) -> &Token {
        &self.tokens[self.current].token
    }
    fn location(&self) -> SourceLocation {
        let token = &self.tokens[self.current];
        SourceLocation::new(token.line, token.column)
    }
    fn error_here(&mut self, message: &str, hint: &str) {
        self.error_at(self.location(), message, hint);
    }
    fn error_previous(&mut self, message: &str, hint: &str) {
        let token = &self.tokens[self.current.saturating_sub(1)];
        self.error_at(SourceLocation::new(token.line, token.column), message, hint);
    }
    fn error_at(&mut self, location: SourceLocation, message: &str, hint: &str) {
        self.errors.push(Diagnostic::new(
            location.line,
            location.column,
            message,
            hint,
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::Parser;
    use crate::ast::Stmt;
    use crate::lexer::lex;

    fn parse(source: &str) -> Result<Vec<Stmt>, Vec<crate::diagnostics::Diagnostic>> {
        Parser::new(lex(source)).parse()
    }

    #[test]
    fn parses_assignment_functions_loops_arrays_and_objects() {
        let ast = parse(
            r#"
let user = { name: "Saiid", scores: [1, 2] }
let count = 0
count = count + 1
fn first(values) { return values[0] }
while count < 2 { count = count + 1 }
for score in user.scores { print(score) }
print(user.name)
"#,
        )
        .expect("parse succeeds");
        assert!(matches!(ast[0], Stmt::Let { .. }));
        assert!(matches!(ast[2], Stmt::Assign { .. }));
        assert!(matches!(ast[3], Stmt::Function { .. }));
        assert!(matches!(ast[4], Stmt::While { .. }));
        assert!(matches!(ast[5], Stmt::For { .. }));
        assert!(matches!(ast[6], Stmt::Print { .. }));
    }

    #[test]
    fn reports_a_source_located_error_for_malformed_for_loops() {
        let errors = parse("for item items { print(item) }\n")
            .expect_err("for loops require the in keyword");

        assert!(errors.iter().any(|error| {
            error.line == 1 && error.column == 10 && error.message.contains("expected 'in'")
        }));
    }

    #[test]
    fn returns_one_diagnostic_for_each_malformed_statement() {
        let errors =
            parse("let first\nprint(\nlet second\nprint(\n").expect_err("parse should fail");
        assert_eq!(errors.len(), 4);
        assert_eq!(
            errors
                .iter()
                .filter(|error| error.message.contains("Invalid variable declaration"))
                .count(),
            2
        );
        assert_eq!(
            errors
                .iter()
                .filter(|error| error.message.contains("Expected expression"))
                .count(),
            2
        );
    }

    #[test]
    fn rejects_out_of_range_integer_literals_and_unknown_characters() {
        let errors = parse("print(2147483648)\nprint(1) @\n")
            .expect_err("invalid lexer tokens must fail parsing");

        assert!(errors.iter().any(|error| {
            error.line == 1
                && error.column == 7
                && error.message.contains("signed 32-bit integer range")
        }));
        assert!(errors.iter().any(|error| {
            error.line == 2 && error.column == 10 && error.message.contains("unknown character '@'")
        }));
    }
}
