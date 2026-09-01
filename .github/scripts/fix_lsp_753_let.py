from pathlib import Path

p = Path('solvec/src/bin/solvelsp.rs')
s = p.read_text()

needle = '''fn scope_statements(text: &str) -> Option<Vec<Stmt>> {
    parse_document(text).or_else(|| {
        let mut repaired = text.to_string();
        repaired.push_str("__solvelsp_completion");
        parse_document(&repaired)
    })
}

'''
insert = needle + '''fn collect_let_activations(statements: &[Stmt], activations: &mut Vec<(String, SourceLocation)>) {
    for statement in statements {
        match statement {
            Stmt::Let { name, value, .. } => {
                activations.push((name.clone(), expr_latest_location(value)));
            }
            Stmt::Function { body, .. } | Stmt::While { body, .. } => {
                collect_let_activations(body, activations);
            }
            Stmt::Export {
                declaration: ExportedDeclaration::Function { body, .. },
                ..
            } => collect_let_activations(body, activations),
            Stmt::For { body, .. } => collect_let_activations(body, activations),
            Stmt::If {
                then_branch,
                else_branch,
                ..
            } => {
                collect_let_activations(then_branch, activations);
                collect_let_activations(else_branch, activations);
            }
            _ => {}
        }
    }
}

fn let_activations(text: &str) -> Vec<(String, SourceLocation)> {
    let Some(statements) = scope_statements(text) else {
        return Vec::new();
    };
    let mut activations = Vec::new();
    collect_let_activations(&statements, &mut activations);
    activations
}

'''
if needle not in s:
    raise SystemExit('scope_statements anchor not found')
s = s.replace(needle, insert, 1)

old = '''    let scope_bindings = function_scope_bindings(text, &tokens);
    let mut scopes = vec![HashSet::<String>::new()];
    for (index, token) in tokens.iter().enumerate() {
        let token_line = token.line.saturating_sub(1);
        let token_character = token_start_utf16(text, token);
        if token_line > line || (token_line == line && token_character > character) {
            break;
        }

        match &token.token {
'''
new = '''    let scope_bindings = function_scope_bindings(text, &tokens);
    let mut pending_lets = let_activations(text);
    let mut scopes = vec![HashSet::<String>::new()];
    for (index, token) in tokens.iter().enumerate() {
        let token_line = token.line.saturating_sub(1);
        let token_character = token_start_utf16(text, token);
        if token_line > line || (token_line == line && token_character > character) {
            break;
        }

        let current = SourceLocation::new(token.line, token.column);
        let mut activated = Vec::new();
        pending_lets.retain(|(declared, initializer_end)| {
            if (initializer_end.line, initializer_end.column) < (current.line, current.column) {
                activated.push(declared.clone());
                false
            } else {
                true
            }
        });
        if let Some(scope) = scopes.last_mut() {
            scope.extend(activated);
        }

        match &token.token {
'''
if old not in s:
    raise SystemExit('active shadow prelude not found')
s = s.replace(old, new, 1)

old_let = '''            lexer::Token::Let => {
                if let Some(declared) =
                    tokens[index + 1..]
                        .iter()
                        .find_map(|candidate| match &candidate.token {
                            lexer::Token::Identifier(value) => Some(value.clone()),
                            lexer::Token::Newline => None,
                            _ => None,
                        })
                    && let Some(scope) = scopes.last_mut()
                {
                    scope.insert(declared);
                }
            }
'''
if old_let not in s:
    raise SystemExit('old immediate let activation not found')
s = s.replace(old_let, '', 1)

test_anchor = '''    #[test]
    fn lexical_namespace_shadow_blocks_module_member_navigation() {
'''
new_test = '''    #[test]
    fn let_initializer_still_resolves_import_before_shadow_activates() {
        let mut documents = HashMap::new();
        open(
            &mut documents,
            "file:///project/state.solve",
            "export let value = 1\\n",
        );
        let source = "import \\"state.solve\\" as state\\nfn read() { let state = state.value return state }\\n";
        open(&mut documents, "file:///project/main.solve", source);
        let line = source.lines().nth(1).unwrap();
        let rhs = line.find("state.value").unwrap() + "state.".len();
        let initializer = process_message(
            json!({"id":38,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":rhs}}}),
            &mut documents,
        );
        assert_eq!(
            initializer[0]["result"]["uri"],
            "file:///project/state.solve"
        );

        let returned = line.rfind("state").unwrap();
        let after_initializer = process_message(
            json!({"id":39,"method":"textDocument/definition","params":{"textDocument":{"uri":"file:///project/main.solve"},"position":{"line":1,"character":returned}}}),
            &mut documents,
        );
        assert!(after_initializer[0]["result"].is_null());
    }

'''
if test_anchor not in s:
    raise SystemExit('test anchor not found')
s = s.replace(test_anchor, new_test + test_anchor, 1)

p.write_text(s)
