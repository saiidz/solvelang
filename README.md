# SolveLang

SolveLang is a readable, workflow-focused programming language built for automation, APIs, files, and AI-native scripting.

It is currently an early working prototype written in Rust. SolveLang is designed to make automation code easier to read, write, and extend.

## What SolveLang Can Do Now

SolveLang currently supports:

- variables
- print statements
- integer math: `+`, `-`, `*`, `/`
- if / else statements
- boolean operators: `and`, `or`, `not`
- comparison operators: `>`, `<`, `>=`, `<=`, `==`, `!=`
- functions
- return values
- while loops
- arrays
- objects/maps
- property access with dot syntax
- string-key access with brackets
- booleans
- string joining using `..`
- comments using `//`
- imports
- file reading and writing
- environment variable access
- JSON parsing and stringifying
- HTTP GET and HTTP POST
- lexer
- parser
- AST
- AST runtime
- diagnostics
- integration-style examples

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



q
eof
