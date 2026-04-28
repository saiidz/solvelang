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

pub fn lex(source: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = source.chars().peekable();

    while let Some(character) = chars.next() {
        match character {
            ' ' | '\t' | '\r' => {}
            '\n' => tokens.push(Token::Newline),
            '0'..='9' => {
                let mut number = character.to_string();
                while let Some(next) = chars.peek() {
                    if next.is_ascii_digit() {
                        number.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                tokens.push(Token::Number(number.parse::<i32>().unwrap_or(0)));
            }
            'a'..='z' | 'A'..='Z' | '_' => {
                let mut word = character.to_string();
                while let Some(next) = chars.peek() {
                    if next.is_alphanumeric() || *next == '_' {
                        word.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }
                tokens.push(keyword_or_identifier(&word));
            }
            '"' => {
                let mut text = String::new();
                for next in chars.by_ref() {
                    if next == '"' {
                        break;
                    }
                    text.push(next);
                }
                tokens.push(Token::Text(text));
            }
            '/' => {
                if chars.peek() == Some(&'/') {
                    for next in chars.by_ref() {
                        if next == '\n' {
                            tokens.push(Token::Newline);
                            break;
                        }
                    }
                } else {
                    tokens.push(Token::Slash);
                }
            }
            '+' => tokens.push(Token::Plus),
            '-' => tokens.push(Token::Minus),
            '*' => tokens.push(Token::Star),
            '.' => {
                if chars.peek() == Some(&'.') {
                    chars.next();
                    tokens.push(Token::Join);
                }
            }
            '=' => {
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::EqualEqual);
                } else {
                    tokens.push(Token::Equal);
                }
            }
            '!' => {
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::BangEqual);
                }
            }
            '>' => {
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::GreaterEqual);
                } else {
                    tokens.push(Token::Greater);
                }
            }
            '<' => {
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::LessEqual);
                } else {
                    tokens.push(Token::Less);
                }
            }
            '(' => tokens.push(Token::LeftParen),
            ')' => tokens.push(Token::RightParen),
            '{' => tokens.push(Token::LeftBrace),
            '}' => tokens.push(Token::RightBrace),
            '[' => tokens.push(Token::LeftBracket),
            ']' => tokens.push(Token::RightBracket),
            ',' => tokens.push(Token::Comma),
            _ => {}
        }
    }

    tokens.push(Token::Eof);
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
