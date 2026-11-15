# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added
- `scan`: discovers MCP servers from user, local and project scope; connects over
  stdio, streamable HTTP (SSE fallback) with a 10s timeout; classifies every tool as
  critical / write / read / unknown with a reason; `--offline` and `--json`.
- `lock` / `unlock`: merge deny/ask permission rules into Claude Code settings
  (user, project or local scope; balanced or strict), with diff, confirmation, backup,
  idempotent hook registration and exact undo via `~/.mcp-leash/state.json`.
- `hook`: dependency-free PreToolUse hook (`dist/hook.mjs`) with argument rules from
  `rules.json`, redacted audit log and fail-open behaviour (`failClosed` opt-in).
- `log`: pretty or JSON view of the audit log.
- Presets for GitHub, filesystem, Slack, Postgres, SQLite, Supabase, Stripe, Notion,
  Linear, Puppeteer, Playwright, Docker, Kubernetes, AWS, shell and Desktop Commander.
