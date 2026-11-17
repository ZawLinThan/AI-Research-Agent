---
name: code-style-convention
description: Apply formatting, naming, and readability conventions when writing, editing, reviewing, or refactoring code. Use especially to check blank-line separation around control flow and distinct operations.
---

# Code Style Conventions

Inspect the project's formatter, linter, and nearby code first. Resolve conflicts in this order: language syntax and correctness, explicit user requirements, enforced project tooling, existing project conventions, then the defaults below. Report conflicts that prevent meeting a requested rule.

- Default to 120 characters per line, spaces for indentation, one statement per line, and no trailing whitespace. Follow language and project conventions for delimiters, indentation, and spacing.
- Use descriptive names and consistent domain terminology. Follow the language's conventions for variables, functions, types, and constants. Group imports as the project does; remove unused or duplicate imports and avoid wildcard imports where practical.
- **Use exactly one blank line before and after a standalone control-flow construct or distinct group of executable operations** when it separates neighboring statements and syntax and tooling permit it. Treat `if/else`, `try/catch/finally`, and `do/while` as single constructs. Keep related declarations or tightly related operations together. Do not pad the edges of an enclosing block merely to add a blank line.

```java
int x = 0;
int y = 1;

while (x < y) {
    x++;
}

int result = x + y;

if (result > 0) {
    process(result);
}

return result;
```

- Use braces for control-flow bodies where supported unless the project requires otherwise. Prefer early returns when they reduce nesting. Handle cases deliberately and avoid unintended fall-through. Keep functions focused, use narrow visibility, and reuse existing abstractions.
- Document public APIs and non-obvious decisions using the language's documentation conventions. Keep documentation consistent with parameters and return values. Remove redundant comments, dead code, and unused declarations within scope.
- Preserve behavior for style-only edits. Keep formatting and cleanup within the requested scope.

Before completing an edit, run the project formatter on affected files, lint or static analysis, type-checking or compilation where applicable, and relevant tests. Inspect the resulting diff for blank-line separation, unrelated formatting, and unintended behavior changes. Report what ran and any failures or gaps. For review-only requests, report findings without editing files.
