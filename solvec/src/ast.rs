use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourceLocation {
    pub line: usize,
    pub column: usize,
    pub end_column: Option<usize>,
}

impl SourceLocation {
    pub const fn new(line: usize, column: usize) -> Self {
        Self {
            line,
            column,
            end_column: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Expr {
    pub kind: ExprKind,
    pub location: SourceLocation,
}

impl Expr {
    pub fn new(kind: ExprKind, location: SourceLocation) -> Self {
        Self { kind, location }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ExprKind {
    Number(i32),
    Text(String),
    Bool(bool),
    Variable(String),
    Array(Vec<Expr>),
    Object(BTreeMap<String, Expr>),
    Property(Box<Expr>, String),
    Index(Box<Expr>, Box<Expr>),
    Unary {
        operator: UnaryOp,
        expr: Box<Expr>,
    },
    Binary {
        left: Box<Expr>,
        operator: BinaryOp,
        right: Box<Expr>,
    },
    Call {
        name: String,
        args: Vec<Expr>,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum UnaryOp {
    Not,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BinaryOp {
    Add,
    Subtract,
    Multiply,
    Divide,
    Join,
    And,
    Or,
    Equal,
    NotEqual,
    Greater,
    GreaterEqual,
    Less,
    LessEqual,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Stmt {
    Let {
        name: String,
        value: Expr,
        location: SourceLocation,
    },
    Assign {
        name: String,
        value: Expr,
        location: SourceLocation,
    },
    Print {
        value: Expr,
        location: SourceLocation,
    },
    Return {
        value: Expr,
        location: SourceLocation,
    },
    Function {
        name: String,
        params: Vec<String>,
        body: Vec<Stmt>,
        location: SourceLocation,
    },
    If {
        condition: Expr,
        then_branch: Vec<Stmt>,
        else_branch: Vec<Stmt>,
        location: SourceLocation,
    },
    While {
        condition: Expr,
        body: Vec<Stmt>,
        location: SourceLocation,
    },
    Agent {
        name: String,
        instruction: String,
        tools: Vec<String>,
        location: SourceLocation,
    },
    Ask {
        agent: String,
        message: Expr,
        location: SourceLocation,
    },
    Expr(Expr),
}
