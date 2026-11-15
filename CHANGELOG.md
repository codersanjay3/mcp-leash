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

### Requirements
- Node 20 or newer (Node 18 reached end of life in April 2025). CI tests Node 20, 22 and 24
  on Ubuntu and macOS.

### Security and robustness
- Project `.mcp.json` stdio servers are only started with `--trust-project` or an interactive yes.
- Scanned servers run in their own process group and are killed with all their children; one
  10s deadline per server.
- Settings writes follow symlinks and keep the file mode; lock validates state and hook source
  before touching settings, re-reads settings after the prompt, and rolls state back on failure.
- Hook: per-rule error isolation, audit always attempted, 2048-char regex input cap, 800ms
  watchdog, broader redaction, audit log mode 0600.
- `scan`/`lock` warn about enabled plugins (their MCP servers are not covered yet).
