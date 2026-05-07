use std::collections::BTreeMap;
use std::fmt;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Number(i32),
    Text(String),
    Bool(bool),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>),
    Null,
}

impl Value {
    pub fn as_number(&self) -> Option<i32> {
        match self {
            Value::Number(value) => Some(*value),
            Value::Text(value) => value.parse::<i32>().ok(),
            Value::Bool(true) => Some(1),
            Value::Bool(false) => Some(0),
            _ => None,
        }
    }

    pub fn is_truthy(&self) -> bool {
        match self {
            Value::Bool(value) => *value,
            Value::Number(value) => *value != 0,
            Value::Text(value) => !value.is_empty(),
            Value::Array(value) => !value.is_empty(),
            Value::Object(value) => !value.is_empty(),
            Value::Null => false,
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Number(value) => write!(formatter, "{}", value),
            Value::Text(value) => write!(formatter, "{}", value),
            Value::Bool(value) => write!(formatter, "{}", value),
            Value::Array(values) => {
                let text = values
                    .iter()
                    .map(|value| value.to_string())
                    .collect::<Vec<String>>()
                    .join(", ");
                write!(formatter, "[{}]", text)
            }
            Value::Object(entries) => {
                let text = entries
                    .iter()
                    .map(|(key, value)| format!("{}: {}", key, value))
                    .collect::<Vec<String>>()
                    .join(", ");
                write!(formatter, "{{{}}}", text)
            }
            Value::Null => write!(formatter, "null"),
        }
    }
}
