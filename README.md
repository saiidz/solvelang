# SolveLang

SolveLang is a readable, workflow-focused programming language built for automation, APIs, files, and AI-native scripting.

It is currently an early working prototype written in Rust.

## Features

- variables
- print statements
- integer math
- if / else
- boolean operators: `and`, `or`, `not`
- functions
- while loops
- arrays
- objects/maps
- property access
- imports
- file I/O
- environment variables
- JSON parse/stringify
- HTTP GET and POST
- lexer, parser, AST, AST runtime
- diagnostics

## Example

```solve
let user = {
  name: "Saiid",
  active: true,
  plan: "pro"
}

if user.active == true and user.plan == "pro" {
  print("access granted")
}

let response = http_get("https://httpbin.org/get")
let data = json_parse(response.body)
print(data.url)
