from pathlib import Path
p = Path('solvec/src/bin/solvelsp.rs')
s = p.read_text()
old = '''            lexer::Token::RightBrace => {
                if scopes.len() > 1 {
                    scopes.pop();
                }
            }
'''
new = '''            lexer::Token::RightBrace if scopes.len() > 1 => {
                scopes.pop();
            }
            lexer::Token::RightBrace => {}
'''
if old not in s:
    raise SystemExit('expected RightBrace match not found')
p.write_text(s.replace(old, new, 1))
