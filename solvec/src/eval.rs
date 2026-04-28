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

    false
}

pub fn eval(expr: &str, vars: &HashMap<String, String>) -> String {
    let expr = expr.trim();

    if expr.starts_with('"') && expr.ends_with('"') {
        return expr.trim_matches('"').to_string();
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

fn split_math(expr: &str) -> Option<(&str, char, &str)> {
    for op in ['+', '-', '*', '/'] {
        if let Some(index) = expr.find(op) {
            if op == '-' && index == 0 {
                continue;
            }

            return Some((&expr[..index], op, &expr[index + 1..]));
        }
    }

    None
}
