---
name: environment-variable-management
description: Add or change application environment variables in projects that centralize configuration in env.ts. Use when wiring settings, credentials, or defaults into application code or reviewing those changes.
---

# Environment Variable Management

- Check the relevant `env.ts` for an existing definition before adding a variable. Reuse it when it represents the same setting.
- Application code must import the validated `env` object from the project's `env.ts` using the project's normal import convention. Read `process.env` directly only in `env.ts` or configuration bootstrap files that must run before it.
- For every new variable, update all three files: add the key to local `.env` without overwriting existing values, put a safe placeholder in `.env.example`, and declare, validate, and export it through `env.ts`. If no local value is available, leave a safe placeholder and tell the user what to supply privately.
- Validate the environment through Zod at startup. Required variables must fail fast when missing or invalid; preserve appropriate types, optionality, and defaults. Test successful parsing and rejection of missing or invalid required values using test inputs.
- Never print, log, commit, or expose secret values. Keep local `.env` out of version control and verify example values are safe.

Before completing a change, verify the three files were updated for each new variable, search modified application code for direct `process.env` access, and run the relevant validation tests and type check. Report what passed and what could not be run without disclosing secret values.
