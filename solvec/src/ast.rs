use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Number(i32),
    Text(String),
    Bool(bool),
    Variable(String),
    Array(Vec<Expr>),
    Object(BTreeMap<String, Expr>),
    Property(Box<Expr>, String),
    Index(Box<Expr>, Box<Expr>),
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
pub enum BinaryOp {
    Add,
    Subtract,
    Multiply,
    Divide,
    Join,
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
    },
    Print(Expr),
    Return(Expr),
    Function {
        name: String,
        params: Vec<String>,
        body: Vec<Stmt>,
    },
    If {
        condition: Expr,
        then_branch: Vec<Stmt>,
        else_branch: Vec<Stmt>,
    },
    While {
        condition: Expr,
        body: Vec<Stmt>,
    },
    Agent {
        name: String,
        instruction: String,
        tools: Vec<String>,
    },
    Ask {
        agent: String,
        message: Expr,
    },
    Expr(Expr),
}
