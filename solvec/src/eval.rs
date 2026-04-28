use std::collections::HashMap;

pub fn eval_condition(condition: &str, vars: &HashMap<String, String>) -> bool {
    for op in [">=", "<=", "==", "!=", ">", "<"] {
        if let Some(index) = condition.find(op) {
            let left = condition[..index].trim();
            let right = condition[index + op.len()..].trim();

            let left_value = eval(left, vars);
            let right_value = eval(right, vars);

            if let (Ok(left_num), Ok(right_num)) =
                (left_value.parse::<i32>(), right_value.parse::<i32>())
            {
                return match op {
                    ">" => left_num > right_num,
                    "<" => left_num < right_num,
                    ">=" => left_num >= right_num,
                    "<=" => left_num <= right_num,
                    "==" => left_num == right_num,
                    "!=" => left_num != right_num,
                    _ => false,
                };
            }

            return match op {
                "==" => left_value == right_value,
                "!=" => left_value != right_value,
                _ => false,
            };
        }
    }

    eval(condition, vars) == "true"
}

pub fn eval(expr: &str, vars: &HashMap<String, String>) -> String {
    let expr = expr.trim();

    if expr.is_empty() {
        return String::new();
    }

    if expr == "true" || expr == "false" {
        return expr.to_string();
    }

    if expr.starts_with('"') && expr.ends_with('"') {
        return expr.trim_matches('"').to_string();
    }

    if expr.starts_with('[') && expr.ends_with(']') {
        return eval_array(expr, vars);
    }

    if let Some((name, index_expr)) = parse_index_access(expr) {
        let array_value = eval(name, vars);
        let index_value = eval(index_expr, vars);
        let index = index_value.parse::<usize>().unwrap_or(0);
        return get_array_item(&array_value, index);
    }

    if let Some((left, right)) = split_string_join(expr) {
        return format!("{}{}", eval(left, vars), eval(right, vars));
    }

    if let Some((left, op, right)) = split_math(expr) {
        let left_value = eval(left, vars);
        let right_value = eval(right, vars);

        let left_number = left_value.parse::<i32>().unwrap_or(0);
        let right_number = right_value.parse::<i32>().unwrap_or(0);

        let result = match op {
            '+' => left_number + right_number,
            '-' => left_number - right_number,
            '*' => left_number * right_number,
            '/' => {
                if right_number == 0 {
                    println!("Error: cannot divide by zero");
                    return "0".to_string();
                }

                left_number / right_number
            }
            _ => 0,
        };

        return result.to_string();
    }

    if let Ok(number) = expr.parse::<i32>() {
        return number.to_string();
    }

    if let Some(value) = vars.get(expr) {
        return value.to_string();
    }

    expr.to_string()
}

pub fn split_args(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut bracket_depth = 0;

    for character in input.chars() {
        match character {
            '"' => {
                in_string = !in_string;
                current.push(character);
            }
            '[' if !in_string => {
                bracket_depth += 1;
                current.push(character);
            }
            ']' if !in_string => {
                bracket_depth -= 1;
                current.push(character);
            }
            ',' if !in_string && bracket_depth == 0 => {
                args.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(character),
        }
    }

    if !current.trim().is_empty() {
        args.push(current.trim().to_string());
    }

    args
}

fn eval_array(expr: &str, vars: &HashMap<String, String>) -> String {
    let inner = expr.trim_start_matches('[').trim_end_matches(']');
    let values: Vec<String> = split_args(inner)
        .iter()
        .map(|item| eval(item, vars))
        .collect();

    format!("[{}]", values.join("|"))
}

fn get_array_item(array_value: &str, index: usize) -> String {
    let inner = array_value.trim_start_matches('[').trim_end_matches(']');
    let values: Vec<&str> = if inner.is_empty() {
        Vec::new()
    } else {
        inner.split('|').collect()
    };

    values.get(index).unwrap_or(&"").to_string()
}

fn parse_index_access(expr: &str) -> Option<(&str, &str)> {
    if !expr.ends_with(']') {
        return None;
    }

    let open = expr.find('[')?;
    let name = expr[..open].trim();
    let index = expr[open + 1..expr.len() - 1].trim();

    if name.is_empty() || index.is_empty() {
        return None;
    }

    Some((name, index))
}

fn split_string_join(expr: &str) -> Option<(&str, &str)> {
    find_token(expr, "..").map(|index| (&expr[..index], &expr[index + 2..]))
}

fn split_math(expr: &str) -> Option<(&str, char, &str)> {
    for op in ['+', '-'] {
        if let Some(index) = find_operator(expr, op) {
            return Some((&expr[..index], op, &expr[index + 1..]));
        }
    }

    for op in ['*', '/'] {
        if let Some(index) = find_operator(expr, op) {
            return Some((&expr[..index], op, &expr[index + 1..]));
        }
    }

    None
}

fn find_operator(expr: &str, op: char) -> Option<usize> {
    let mut in_string = false;
    let mut bracket_depth = 0;

    for (index, character) in expr.char_indices().rev() {
        match character {
            '"' => in_string = !in_string,
            ']' if !in_string => bracket_depth += 1,
            '[' if !in_string => bracket_depth -= 1,
            _ => {}
        }

        if in_string || bracket_depth != 0 {
            continue;
        }

        if character == op {
            if op == '-' && index == 0 {
                continue;
            }

            return Some(index);
        }
    }

    None
}

fn find_token(expr: &str, token: &str) -> Option<usize> {
    let mut in_string = false;
    let mut bracket_depth = 0;
    let chars: Vec<char> = expr.chars().collect();
    let token_chars: Vec<char> = token.chars().collect();

    if token_chars.is_empty() || chars.len() < token_chars.len() {
        return None;
    }

    let mut i = 0;
    while i + token_chars.len() <= chars.len() {
        match chars[i] {
            '"' => in_string = !in_string,
            '[' if !in_string => bracket_depth += 1,
            ']' if !in_string => bracket_depth -= 1,
            _ => {}
        }

        if !in_string && bracket_depth == 0 && chars[i..i + token_chars.len()] == token_chars[..] {
            return Some(i);
        }

        i += 1;
    }

    None
}
