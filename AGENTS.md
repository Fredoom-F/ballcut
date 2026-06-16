# Codex Team Configuration

This project uses a five-layer Codex working structure:

1. Memory: stable project rules and engineering agreements.
2. Knowledge: reusable skills, scripts, templates, and context.
3. Guardrails: hooks for checks, logging, and automation.
4. Delegation: focused subagents for review, testing, and exploration.
5. Distribution: plugin metadata for team reuse.

## Working Rules

- Read `CLAUDE.md/global.md`, `CLAUDE.md/project.md`, and `CLAUDE.md/architecture.rules` before changing code.
- Prefer small, reversible changes that match the existing project style.
- Keep user-facing language clear and non-technical unless technical detail is requested.
- Run the most relevant checks after edits when the project provides them.
- Do not overwrite user work. If existing files change during work, treat them as intentional.

## Architecture Flow

`AGENTS.md` defines the rules, `skills/` provides reusable capability, `hooks/` protects execution, `subagents/` splits specialized work, and `plugins/` packages the setup for team reuse.

