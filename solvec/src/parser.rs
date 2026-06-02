use std::collections::BTreeMap;

use crate::ast::{BinaryOp, Expr, Stmt};
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

            if let Some(statement) = self.statement() {
                statements.push(statement);
            } else {
                self.advance();
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
            Token::Agent => self.agent_statement(),
            Token::Ask => self.ask_statement(),
            Token::Identifier(_) if self.check_next(&Token::Equal) => self.assignment_statement(),
            _ => self.expression_statement(),
        }
    }

    fn let_statement(&mut self) -> Option<Stmt> {
        self.advance();
        let name = self.consume_identifier("Expected variable name after 'let'.")?;
        self.consume(
            &Token::Equal,
            "Invalid variable declaration: expected '='.",
            "Use syntax like: let name = value",
        );
        let value = self.expression();
        Some(Stmt::Let { name, value })
    }

    fn assignment_statement(&mut self) -> Option<Stmt> {
        let name = self.consume_identifier("Expected variable name before '='.")?;
        self.consume(
            &Token::Equal,
            "Invalid assignment: expected '='.",
            "Use syntax like: name = value",
        );
        let value = self.expression();
        Some(Stmt::Assign { name, value })
    }

    fn print_statement(&mut self) -> Option<Stmt> {
        self.advance();
        self.consume(
            &Token::LeftParen,
            "Invalid print statement: expected '('.",
            "Use syntax like: print(value)",
        );
        let value = self.expression();
        self.consume(
            &Token::RightParen,
            "Invalid print statement: expected ')'.",
            "Close the print call with ')'.",
        );
        Some(Stmt::Print(value))
    }

    fn return_statement(&mut self) -> Option<Stmt> {
        self.advance();
        Some(Stmt::Return(self.expression()))
    }

    fn function_statement(&mut self) -> Option<Stmt> {
        self.advance();
        let name = self.consume_identifier("Expected function name after 'fn'.")?;
        let params = self.parameter_list();
        let body = self.block();
        Some(Stmt::Function { name, params, body })
    }

    fn if_statement(&mut self) -> Option<Stmt> {
        self.advance();
        let condition = self.expression();
        let then_branch = self.block();

        self.skip_newlines();
        let else_branch = if self.matches(&Token::Else) {
            self.block()
        } else {
            Vec::new()
        };

        Some(Stmt::If {
            condition,
            then_branch,
            else_branch,
        })
    }

    fn while_statement(&mut self) -> Option<Stmt> {
        self.advance();
        let condition = self.expression();
        let body = self.block();
        Some(Stmt::While { condition, body })
    }

    fn agent_statement(&mut self) -> Option<Stmt> {
        self.advance();
        let name = self.consume_identifier("Expected agent name after 'agent'.")?;
        self.consume(
            &Token::LeftBrace,
            "Invalid agent declaration: missing opening '{'.",
            "Use syntax like: agent SupportBot {",
        );
        self.skip_newlines();

        let mut instruction = String::new();
        let mut tools = Vec::new();

        while !self.check(&Token::RightBrace) && !self.is_at_end() {
            self.skip_newlines();

            if self.matches(&Token::Instruction) {
                match self.advance() {
                    Token::Text(value) => instruction = value,
                    _ => self.error_here(
                        "Invalid agent instruction: expected quoted text.",
                        "Use syntax like: instruction \"Answer clearly.\"",
                    ),
                }
            } else if self.matches(&Token::Tool) {
                if let Some(tool) = self.consume_identifier("Expected tool name after 'tool'.") {
                    tools.push(tool);
                }
            } else {
                self.advance();
            }

            self.skip_newlines();
        }

        self.consume(
            &Token::RightBrace,
            "Unclosed agent block: missing '}'.",
            "Add a matching closing brace after the agent body.",
        );
        Some(Stmt::Agent {
            name,
            instruction,
            tools,
        })
    }

    fn ask_statement(&mut self) -> Option<Stmt> {
        self.advance();
        let agent = self.consume_identifier("Expected agent name after 'ask'.")?;
        self.consume(
            &Token::LeftParen,
            "Invalid ask statement: expected '('.",
            "Use syntax like: ask SupportBot(\"message\")",
        );
        let message = self.expression();
        self.consume(
            &Token::RightParen,
            "Invalid ask statement: expected ')'.",
            "Close the ask call with ')'.",
        );
        Some(Stmt::Ask { agent, message })
    }

    fn expression_statement(&mut self) -> Option<Stmt> {
        Some(Stmt::Expr(self.expression()))
    }

    fn block(&mut self) -> Vec<Stmt> {
        self.consume(
            &Token::LeftBrace,
            "Invalid block: missing opening '{'.",
            "Add '{' before the block body.",
        );
        self.skip_newlines();

        let mut statements = Vec::new();

        while !self.check(&Token::RightBrace) && !self.is_at_end() {
            self.skip_newlines();

            if self.check(&Token::RightBrace) || self.is_at_end() {
                break;
            }

            if let Some(statement) = self.statement() {
                statements.push(statement);
            } else {
                self.advance();
            }

            self.skip_newlines();
        }

        self.consume(
            &Token::RightBrace,
            "Unclosed block: missing '}'.",
            "Add a matching closing brace after the block body.",
        );
        statements
    }

    fn parameter_list(&mut self) -> Vec<String> {
        let mut params = Vec::new();
        self.consume(
            &Token::LeftParen,
            "Invalid function declaration: expected parameter list.",
            "Use syntax like: fn name(arg) {",
        );

        while !self.check(&Token::RightParen) && !self.is_at_end() {
            if let Some(param) = self.consume_identifier("Expected parameter name.") {
                params.push(param);
            }

            if !self.matches(&Token::Comma) {
                break;
            }
        }

        self.consume(
            &Token::RightParen,
            "Invalid function declaration: expected ')'.",
            "Close the parameter list with ')'.",
        );
        params
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
        let mut expr = self.and();

        while self.matches(&Token::Or) {
            let right = self.and();
            expr = Expr::Binary {
                left: Box::new(expr),
                operator: BinaryOp::Or,
                right: Box::new(right),
            };
        }

        expr
    }

    fn and(&mut self) -> Expr {
        let mut expr = self.equality();

        while self.matches(&Token::And) {
            let right = self.equality();
            expr = Expr::Binary {
                left: Box::new(expr),
                operator: BinaryOp::And,
                right: Box::new(right),
            };
        }

        expr
    }

    fn equality(&mut self) -> Expr {
        let mut expr = self.comparison();

        while self.matches(&Token::EqualEqual) || self.matches(&Token::BangEqual) {
            let operator = match self.previous() {
                Token::EqualEqual => BinaryOp::Equal,
                Token::BangEqual => BinaryOp::NotEqual,
                _ => BinaryOp::Equal,
            };
            let right = self.comparison();
            expr = Expr::Binary {
                left: Box::new(expr),
                operator,
                right: Box::new(right),
            };
        }

        expr
    }

    fn comparison(&mut self) -> Expr {
        let mut expr = self.term();

        while self.matches(&Token::Greater)
            || self.matches(&Token::GreaterEqual)
            || self.matches(&Token::Less)
            || self.matches(&Token::LessEqual)
        {
            let operator = match self.previous() {
                Token::Greater => BinaryOp::Greater,
                Token::GreaterEqual => BinaryOp::GreaterEqual,
                Token::Less => BinaryOp::Less,
                Token::LessEqual => BinaryOp::LessEqual,
                _ => BinaryOp::Equal,
            };
            let right = self.term();
            expr = Expr::Binary {
                left: Box::new(expr),
                operator,
                right: Box::new(right),
            };
        }

        expr
    }

    fn term(&mut self) -> Expr {
        let mut expr = self.factor();

        while self.matches(&Token::Plus)
            || self.matches(&Token::Minus)
            || self.matches(&Token::Join)
        {
            let operator = match self.previous() {
                Token::Plus => BinaryOp::Add,
                Token::Minus => BinaryOp::Subtract,
                Token::Join => BinaryOp::Join,
                _ => BinaryOp::Add,
            };
            let right = self.factor();
            expr = Expr::Binary {
                left: Box::new(expr),
                operator,
                right: Box::new(right),
            };
        }

        expr
    }

    fn factor(&mut self) -> Expr {
        let mut expr = self.unary();

        while self.matches(&Token::Star) || self.matches(&Token::Slash) {
            let operator = match self.previous() {
                Token::Star => BinaryOp::Multiply,
                Token::Slash => BinaryOp::Divide,
                _ => BinaryOp::Multiply,
            };
            let right = self.unary();
            expr = Expr::Binary {
                left: Box::new(expr),
                operator,
                right: Box::new(right),
            };
        }

        expr
    }

    fn unary(&mut self) -> Expr {
        if self.matches(&Token::Not) {
            return Expr::Unary {
                operator: crate::ast::UnaryOp::Not,
                expr: Box::new(self.unary()),
            };
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
                expr = Expr::Index(Box::new(expr), Box::new(index));
            } else if self.matches(&Token::Dot) {
                let name = self.consume_identifier("Expected property name after '.'.");
                if let Some(name) = name {
                    expr = Expr::Property(Box::new(expr), name);
                }
            } else {
                break;
            }
        }

        expr
    }

    fn primary(&mut self) -> Expr {
        match self.advance() {
            Token::Number(value) => Expr::Number(value),
            Token::Text(value) => Expr::Text(value),
            Token::True => Expr::Bool(true),
            Token::False => Expr::Bool(false),
            Token::Identifier(name) => {
                if self.matches(&Token::LeftParen) {
                    let args = self.argument_list();
                    self.consume(
                        &Token::RightParen,
                        "Invalid function call: expected ')'.",
                        "Close the function call with ')'.",
                    );
                    Expr::Call { name, args }
                } else {
                    Expr::Variable(name)
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
                Expr::Array(values)
            }
            Token::LeftBrace => self.object_literal(),
            Token::Newline
            | Token::RightParen
            | Token::RightBrace
            | Token::RightBracket
            | Token::Comma
            | Token::Colon
            | Token::Dot
            | Token::Eof => {
                self.error_previous(
                    "Expected expression.",
                    "Add a number, string, boolean, variable, array, object, or function call here.",
                );
                Expr::Text(String::new())
            }
            other => {
                self.error_previous(
                    &format!("Unexpected token in expression: {:?}", other),
                    "Try a number, string, boolean, variable, array, object, or function call.",
                );
                Expr::Text(String::new())
            }
        }
    }

    fn object_literal(&mut self) -> Expr {
        let mut entries = BTreeMap::new();
        self.skip_newlines();

        while !self.check(&Token::RightBrace) && !self.is_at_end() {
            let key = match self.advance() {
                Token::Identifier(name) => name,
                Token::Text(name) => name,
                _ => {
                    self.error_previous(
                        "Invalid object key.",
                        "Use an identifier or quoted string before ':'.",
                    );
                    String::new()
                }
            };

            self.consume(
                &Token::Colon,
                "Invalid object entry: expected ':'.",
                "Use syntax like: { name: value }",
            );

            let value = self.expression();

            if !key.is_empty() {
                entries.insert(key, value);
            }

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

        Expr::Object(entries)
    }

    fn matches(&mut self, expected: &Token) -> bool {
        if self.check(expected) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn consume(&mut self, expected: &Token, message: &str, hint: &str) {
        if !self.matches(expected) {
            self.error_here(message, hint);
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
        if self.current + 1 >= self.tokens.len() {
            return false;
        }

        std::mem::discriminant(&self.tokens[self.current + 1].token)
            == std::mem::discriminant(expected)
    }

    fn advance(&mut self) -> Token {
        if !self.is_at_end() {
            self.current += 1;
        }
        self.previous().clone()
    }

    fn is_at_end(&self) -> bool {
        matches!(self.peek(), Token::Eof)
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.current].token
    }

    fn previous(&self) -> &Token {
        &self.tokens[self.current.saturating_sub(1)].token
    }

    fn error_here(&mut self, message: &str, hint: &str) {
        let token = &self.tokens[self.current.min(self.tokens.len().saturating_sub(1))];
        self.errors.push(Diagnostic::new(
            token.line,
            token.column,
            message.to_string(),
            hint.to_string(),
        ));
    }

    fn error_previous(&mut self, message: &str, hint: &str) {
        let token = &self.tokens[self.current.saturating_sub(1)];
        self.errors.push(Diagnostic::new(
            token.line,
            token.column,
            message.to_string(),
            hint.to_string(),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::Parser;
    use crate::ast::Stmt;
    use crate::lexer::lex;

    fn parse(source: &str) -> Result<Vec<Stmt>, Vec<crate::diagnostics::Diagnostic>> {
        let mut parser = Parser::new(lex(source));
        parser.parse()
    }

    #[test]
    fn parses_assignment_functions_loops_arrays_and_objects() {
        let ast = parse(
            r#"
let user = { name: "Saiid", scores: [1, 2] }
let count = 0
count = count + 1
fn first(values) {
    return values[0]
}
while count < 2 {
    count = count + 1
}
print(user.name)
"#,
        )
        .expect("parse succeeds");

        assert!(matches!(ast[0], Stmt::Let { .. }));
        assert!(matches!(ast[2], Stmt::Assign { .. }));
        assert!(matches!(ast[3], Stmt::Function { .. }));
        assert!(matches!(ast[4], Stmt::While { .. }));
        assert!(matches!(ast[5], Stmt::Print(_)));
    }

    #[test]
    fn returns_diagnostics_for_parser_failures() {
        let errors = parse("print(add(1, 2)\n").expect_err("parse should fail");

        assert!(
            errors
                .iter()
                .any(|error| error.message.contains("Invalid print statement"))
        );
    }
}
