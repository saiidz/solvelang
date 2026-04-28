use crate::ast::{BinaryOp, Expr, Stmt};
use crate::lexer::Token;

pub struct Parser {
    tokens: Vec<Token>,
    current: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, current: 0 }
    }

    pub fn parse(&mut self) -> Vec<Stmt> {
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

        statements
    }

    fn statement(&mut self) -> Option<Stmt> {
        match self.peek() {
            Token::Let => self.let_statement(),
            Token::Print => self.print_statement(),
            Token::Return => self.return_statement(),
            _ => self.expression_statement(),
        }
    }

    fn let_statement(&mut self) -> Option<Stmt> {
        self.advance();
        let name = match self.advance() {
            Token::Identifier(name) => name,
            _ => return None,
        };

        if !self.matches(&Token::Equal) {
            return None;
        }

        let value = self.expression();
        Some(Stmt::Let { name, value })
    }

    fn print_statement(&mut self) -> Option<Stmt> {
        self.advance();
        self.matches(&Token::LeftParen);
        let value = self.expression();
        self.matches(&Token::RightParen);
        Some(Stmt::Print(value))
    }

    fn return_statement(&mut self) -> Option<Stmt> {
        self.advance();
        Some(Stmt::Return(self.expression()))
    }

    fn expression_statement(&mut self) -> Option<Stmt> {
        Some(Stmt::Expr(self.expression()))
    }

    fn expression(&mut self) -> Expr {
        self.equality()
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

        while self.matches(&Token::Plus) || self.matches(&Token::Minus) || self.matches(&Token::Join) {
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
        let mut expr = self.primary();

        while self.matches(&Token::Star) || self.matches(&Token::Slash) {
            let operator = match self.previous() {
                Token::Star => BinaryOp::Multiply,
                Token::Slash => BinaryOp::Divide,
                _ => BinaryOp::Multiply,
            };
            let right = self.primary();
            expr = Expr::Binary {
                left: Box::new(expr),
                operator,
                right: Box::new(right),
            };
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
                    let mut args = Vec::new();

                    while !self.check(&Token::RightParen) && !self.is_at_end() {
                        args.push(self.expression());
                        if !self.matches(&Token::Comma) {
                            break;
                        }
                    }

                    self.matches(&Token::RightParen);
                    Expr::Call { name, args }
                } else {
                    Expr::Variable(name)
                }
            }
            Token::LeftParen => {
                let expr = self.expression();
                self.matches(&Token::RightParen);
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

                self.matches(&Token::RightBracket);
                Expr::Array(values)
            }
            _ => Expr::Text(String::new()),
        }
    }

    fn skip_newlines(&mut self) {
        while self.matches(&Token::Newline) {}
    }

    fn matches(&mut self, token: &Token) -> bool {
        if self.check(token) {
            self.advance();
            return true;
        }
        false
    }

    fn check(&self, token: &Token) -> bool {
        if self.is_at_end() {
            return false;
        }
        std::mem::discriminant(self.peek()) == std::mem::discriminant(token)
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
        self.tokens.get(self.current).unwrap_or(&Token::Eof)
    }

    fn previous(&self) -> &Token {
        self.tokens.get(self.current.saturating_sub(1)).unwrap_or(&Token::Eof)
    }
}
