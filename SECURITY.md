# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting ("Security" tab, "Report a vulnerability") on this repository.
Include steps to reproduce and the version (`mcp-leash --version`). I aim to respond
within a few days.

## Scope and things to know

- mcp-leash reduces risk; it is not a sandbox. A hook `ask` is a prompt, not a block,
  and rules only cover tools you have scanned or listed in `rules.json`.
- `scan` and `lock` start the stdio MCP servers from your user and local scope config to read
  their tool lists. Servers from a project `.mcp.json` (which can come from an untrusted
  repository) are not started unless you pass `--trust-project` or confirm in an interactive
  terminal; otherwise they are classified from presets only. Started servers run in their own
  process group and the whole group is killed afterwards. Remote project servers are still
  contacted (with `${VAR}` expansion in URL and headers), so avoid scanning untrusted repos
  with secrets in your environment. `--offline` never starts or contacts anything.
- The hook is fail-open by default so it can never lock you out of your own tools by
  accident. Set `"failClosed": true` in `~/.mcp-leash/rules.json` to change that.
- The audit log (`~/.mcp-leash/audit.jsonl`) stores a truncated, redacted preview of tool
  arguments. Redaction is key-name based plus a few well-known token shapes, so treat
  the log as sensitive anyway. URL credentials (`scheme://user:pass@`) and `Bearer` tokens are
  masked too, and the file is created with mode 0600.
- Rule regexes run on at most 2048 characters of an argument, and a watchdog stops the hook after
  about 800 ms (fail-open, or deny with `failClosed`), so a bad pattern cannot hang tool calls.
- mcp-leash edits Claude Code settings files and always writes a timestamped backup first.
  It makes no network requests of its own (apart from connecting to the MCP servers
  you configured during `scan`).

## Supported versions

Only the latest release receives fixes.
