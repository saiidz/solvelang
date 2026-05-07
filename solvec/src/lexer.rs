#[derive(Clone, Debug, PartialEq)]
pub enum Token {
    Let,
    Fn,
    Return,
    If,
    Else,
    While,
    Agent,
    Tool,
    Instruction,
    Ask,
    Print,
    True,
    False,
    Identifier(String),
    Number(i32),
    Text(String),
    Plus,
    Minus,
    Star,
    Slash,
    Join,
    Dot,
    Colon,
    Equal,
    EqualEqual,
    BangEqual,
    Greater,
    GreaterEqual,
    Less,
    LessEqual,
    LeftParen,
    RightParen,
    LeftBrace,
    RightBrace,
    LeftBracket,
    RightBracket,
    Comma,
    Newline,
    Eof,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocatedToken {
    pub token: Token,
    pub line: usize,
    pub column: usize,
}

impl LocatedToken {
    fn new(token: Token, line: usize, column: usize) -> Self {
        Self { token, line, column }
    }
}

pub fn lex(source: &str) -> Vec<LocatedToken> {
    let mut tokens = Vec::new();
    let mut chars = source.chars().peekable();
    let mut line = 1;
    let mut column = 1;

    while let Some(character) = chars.next() {
        let token_line = line;
        let token_column = column;
        column += 1;

        match character {
            ' ' | '\t' | '\r' => {}
            '\n' => {
                tokens.push(LocatedToken::new(Token::Newline, token_line, token_column));
                line += 1;
                column = 1;
            }
            '0'..='9' => {
                let mut number = character.to_string();
                while let Some(next) = chars.peek() {
                    if next.is_ascii_digit() {
                        number.push(chars.next().unwrap());
                        column += 1;
                    } else {
                        break;
                    }
                }
                tokens.push(LocatedToken::new(
                    Token::Number(number.parse::<i32>().unwrap_or(0)),
                    token_line,
                    token_column,
                ));
            }
            'a'..='z' | 'A'..='Z' | '_' => {
                let mut word = character.to_string();
                while let Some(next) = chars.peek() {
                    if next.is_alphanumeric() || *next == '_' {
                        word.push(chars.next().unwrap());
                        column += 1;
                    } else {
                        break;
                    }
                }
                tokens.push(LocatedToken::new(
                    keyword_or_identifier(&word),
                    token_line,
                    token_column,
                ));
            }
            '"' => {
                let mut text = String::new();

                while let Some(next) = chars.next() {
                    column += 1;

                    if next == '\\' {
                        if let Some(escaped) = chars.next() {
                            column += 1;
                            match escaped {
                                '"' => text.push('"'),
                                '\\' => text.push('\\'),
                                'n' => text.push('\n'),
                                't' => text.push('\t'),
                                'r' => text.push('\r'),
                                other => text.push(other),
                            }
                        }
                        continue;
                    }

                    if next == '"' {
                        break;
                    }

                    if next == '\n' {
                        line += 1;
                        column = 1;
                    }

                    text.push(next);
                }

                tokens.push(LocatedToken::new(Token::Text(text), token_line, token_column));
            }
            '/' => {
                if chars.peek() == Some(&'/') {
                    chars.next();
                    column += 1;
                    for next in chars.by_ref() {
                        column += 1;
                        if next == '\n' {
                            tokens.push(LocatedToken::new(Token::Newline, line, column - 1));
                            line += 1;
                            column = 1;
                            break;
                        }
                    }
                } else {
                    tokens.push(LocatedToken::new(Token::Slash, token_line, token_column));
                }
            }
            '+' => tokens.push(LocatedToken::new(Token::Plus, token_line, token_column)),
            '-' => tokens.push(LocatedToken::new(Token::Minus, token_line, token_column)),
            '*' => tokens.push(LocatedToken::new(Token::Star, token_line, token_column)),
            '.' => {
                if chars.peek() == Some(&'.') {
                    chars.next();
                    column += 1;
                    tokens.push(LocatedToken::new(Token::Join, token_line, token_column));
                } else {
                    tokens.push(LocatedToken::new(Token::Dot, token_line, token_column));
                }
            }
            ':' => tokens.push(LocatedToken::new(Token::Colon, token_line, token_column)),
            '=' => {
                if chars.peek() == Some(&'=') {
                    chars.next();
                    column += 1;
                    tokens.push(LocatedToken::new(Token::EqualEqual, token_line, token_column));
                } else {
                    tokens.push(LocatedToken::new(Token::Equal, token_line, token_column));
                }
            }
            '!' => {
                if chars.peek() == Some(&'=') {
                    chars.next();
                    column += 1;
                    tokens.push(LocatedToken::new(Token::BangEqual, token_line, token_column));
                }
            }
            '>' => {
                if chars.peek() == Some(&'=') {
                    chars.next();
                    column += 1;
                    tokens.push(LocatedToken::new(Token::GreaterEqual, token_line, token_column));
                } else {
                    tokens.push(LocatedToken::new(Token::Greater, token_line, token_column));
                }
            }
            '<' => {
                if chars.peek() == Some(&'=') {
                    chars.next();
                    column += 1;
                    tokens.push(LocatedToken::new(Token::LessEqual, token_line, token_column));
                } else {
                    tokens.push(LocatedToken::new(Token::Less, token_line, token_column));
                }
            }
            '(' => tokens.push(LocatedToken::new(Token::LeftParen, token_line, token_column)),
            ')' => tokens.push(LocatedToken::new(Token::RightParen, token_line, token_column)),
            '{' => tokens.push(LocatedToken::new(Token::LeftBrace, token_line, token_column)),
            '}' => tokens.push(LocatedToken::new(Token::RightBrace, token_line, token_column)),
            '[' => tokens.push(LocatedToken::new(Token::LeftBracket, token_line, token_column)),
            ']' => tokens.push(LocatedToken::new(Token::RightBracket, token_line, token_column)),
            ',' => tokens.push(LocatedToken::new(Token::Comma, token_line, token_column)),
            _ => {}
        }
    }

    tokens.push(LocatedToken::new(Token::Eof, line, column));
    tokens
}

fn keyword_or_identifier(word: &str) -> Token {
    match word {
        "let" => Token::Let,
        "fn" => Token::Fn,
        "return" => Token::Return,
        "if" => Token::If,
        "else" => Token::Else,
        "while" => Token::While,
        "agent" => Token::Agent,
        "tool" => Token::Tool,
        "instruction" => Token::Instruction,
        "ask" => Token::Ask,
        "print" => Token::Print,
        "true" => Token::True,
        "false" => Token::False,
        _ => Token::Identifier(word.to_string()),
    }
}
