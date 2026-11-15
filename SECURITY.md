# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting ("Security" tab, "Report a vulnerability") on this repository.
Include steps to reproduce and the version (`mcp-leash --version`). I aim to respond
within a few days.

## Scope and things to know

- mcp-leash reduces risk; it is not a sandbox. A hook `ask` is a prompt, not a block,
  and rules only cover tools you have scanned or listed in `rules.json`.
- `scan` starts the MCP servers from your config to read their tool lists. A project
  `.mcp.json` can contain arbitrary commands, so do not scan an untrusted repository
  (`--offline` never starts anything).
- The hook is fail-open by default so it can never lock you out of your own tools by
  accident. Set `"failClosed": true` in `~/.mcp-leash/rules.json` to change that.
- The audit log (`~/.mcp-leash/audit.jsonl`) stores a truncated, redacted preview of tool
  arguments. Redaction is key-name based plus a few well-known token shapes, so treat
  the log as sensitive anyway.
- mcp-leash edits Claude Code settings files and always writes a timestamped backup first.
  It makes no network requests of its own (apart from connecting to the MCP servers
  you configured during `scan`).

## Supported versions

Only the latest release receives fixes.
