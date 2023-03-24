; CAVEATS:

; * No support for string placeholders in `Printf` functions (injection
; candidate?)

; COMMENTS
; ========

((comment) @comment.line.double-slash.go
  (#match? @comment.line.double-slash.go "^\/\/")
  (#set! final true))

((comment) @punctuation.definition.comment.go
  (#match? @punctuation.definition.comment.go "^\/\/")
  (#set! startAndEndAroundFirstMatchOf "^\/\/"))


((comment) @comment.block.go
  (#match? @comment.block.go "^\\/\\*"))

((comment) @punctuation.definition.comment.begin.go
  (#match? @punctuation.definition.comment.begin.go "^\\/\\*")
  (#set! startAndEndAroundFirstMatchOf "^\\/\\*"))

((comment) @punctuation.definition.comment.end.go
  (#match? @punctuation.definition.comment.end.go "\\*\\/$")
  (#set! startAndEndAroundFirstMatchOf "\\*\\/$"))


; TYPES
; =====

(type_identifier) @storage.type._TYPE_.go

[
  "func"
  "import"
  "package"
] @keyword._TYPE_.go

[
  "break"
  "case"
  "continue"
  "default"
  "defer"
  "else"
  "fallthrough"
  "for"
  "go"
  "goto"
  "if"
  "range"
  "return"
  "select"
  "switch"
] @keyword.control._TYPE_.go

(function_declaration (identifier) @entity.name.function.go)

(call_expression
  (identifier) @support.function.builtin.go
  (#match? @support.function.builtin.go "^(?:append|cap|close|complex|copy|delete|imag|len|make|new|panic|print|println|real|recover)$")
  (#set! final true))

(call_expression
  (identifier) @support.function.other.go)

(call_expression
  (selector_expression
    field: (field_identifier) @support.function.other.go))

; OBJECTS
; =======

(selector_expression
  operand: (selector_expression
    operand: (identifier) @support.object.other.go
    field: (field_identifier) @support.object.other.go))

; TODO: If we do this, then we have to do chaining (`a.b.c.Close()`) and that
; won't be fun.

(selector_expression
  operand: (identifier) @support.object.other.go)

; PACKAGES
; ========

(package_clause
  (package_identifier) @entity.name.package.go
  (#set! final true))

(package_identifier) @support.object.package.go

; STRINGS
; =======

((interpreted_string_literal "\"") @string.quoted.double.go)
(interpreted_string_literal
  "\"" @punctuation.definition.string.begin.go
  (#set! onlyIfFirst true))

(interpreted_string_literal
  "\"" @punctuation.definition.string.end.go
  (#set! onlyIfLast true))

(escape_sequence) @constant.character.escape.go

(rune_literal) @string.quoted.single.rune.go

(raw_string_literal) @string.quoted.raw.go
((raw_string_literal)
  @punctuation.definition.string.begin.go
  (#set! startAndEndAroundFirstMatchOf "^`"))
((raw_string_literal)
  @punctuation.definition.string.end.go
  (#set! startAndEndAroundFirstMatchOf "`$"))


; NUMBERS
; =======

(int_literal) @constant.numeric.integer.go


; VARIABLES
; =========

[
  "var"
  "const"
] @storage.modifier._TYPE_.go

(parameter_declaration (identifier) @variable.parameter.go)
(variadic_parameter_declaration (identifier) @variable.parameter.go)

(range_clause
  (expression_list
    (identifier) @variable.parameter.range.go))

(const_spec
  name: (identifier) @variable.other.assignment.const.go)

(var_spec
  name: (identifier) @variable.other.assignment.var.go)

; (var_declaration
;   (expression_list
;     (identifier) @variable.other.assignment.go))

(short_var_declaration
  (expression_list
    (identifier) @variable.other.assignment.var.go))

(assignment_statement
  (expression_list
    (identifier) @variable.other.assigment.go))

; CONSTANTS
; =========

[
  (true)
  (false)
  (nil)
] @constant.language._TYPE_.go

((identifier) @constant.language.iota.go
  (#eq? @constant.language.iota.go "iota"))

; OPERATORS
; =========

(binary_expression
  [
    "=="
    "!="
    ">"
    "<"
  ] @keyword.operator.comparison.go)

[
  "="
  ":="
] @keyword.operator.assignment.go

[
  "+="
  "-="
  "|="
  "^="
  "*="
  "/="
  "%="
  "<<="
  ">>="
  "&^="
  "&="
] @keyword.operator.assignment.compound.go

"<-" @keyword.operator.channel.go

"++" @keyword.operator.increment.go
"--" @keyword.operator.decrement.go



(binary_expression
  ["+" "-" "*" "/" "%"] @keyword.operator.arithmetic.go)

(binary_expression
  ["&" "|" "^" "&^" "<<" ">>"] @keyword.operator.arithmetic.bitwise.go)

(binary_expression ["&&" "||"] @keyword.operator.logical.go)

(variadic_parameter_declaration "..." @keyword.operator.ellipsis.go)


(pointer_type "*" @keyword.operator.address.go)
(unary_expression ["&" "*"] @keyword.operator.address.go)

(unary_expression "!" @keyword.operator.unary.go)

"." @keyword.operator.accessor.js


; PUNCTUATION
; ===========

";" @punctuation.terminator.go
"," @punctuation.separator.comma.go
":" @punctuation.separator.colon.go

"{" @punctuation.definition.begin.brace.curly.go
"}" @punctuation.definition.end.brace.curly.go
"(" @punctuation.definition.begin.brace.round.go
")" @punctuation.definition.end.brace.round.go
"[" @punctuation.definition.begin.brace.square.go
"]" @punctuation.definition.end.brace.square.go

; META
; ====

(function_declaration
  (block) @meta.block.function.go
  (#set! final true))

(block) @meta.block.go

(import_spec) @meta.import-specifier.go
(import_spec_list) @meta.import-specifier.list.go
