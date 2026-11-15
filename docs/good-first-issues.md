# Good first issues (drafts)

Copy each into a GitHub issue labelled `good first issue`.

## 1. Add a preset for the Git MCP server (`mcp-server-git`)
Add `src/presets/` entry matching `mcp-server-git` / `server-git`. Mark `git_reset`
as critical, `git_commit`, `git_add`, `git_checkout`, `git_create_branch` as write and
`git_status`, `git_diff*`, `git_log`, `git_show` as read. Add tests in
`test/presets.test.ts` and `test/classifier.test.ts`.

## 2. Add presets for Redis and MongoDB MCP servers
Cover `flushall`/`flushdb`/`drop_*` (critical), `set`/`hset`/`insert_*`/`update_*` (write) and
get/list/find (read). Follow the structure of `src/presets/others.ts`.

## 3. Discover plugin-provided MCP servers
Plugin servers are named `mcp__plugin_<plugin>_<server>__<tool>`. Teach `discoverServers`
to read installed plugin manifests so `scan` and `lock` cover them. Needs a fixture plugin in `test/fixtures`.

## 4. `mcp-leash log --since <duration>`
Support `--since 1h` / `2d` in `src/cmd-log.ts`, with unit tests for the duration parsing
and filtering. Keep `--today` working.

## 5. Support `ws` transport in `scan`
`fetchTools` in `src/scanner.ts` currently reports `ws transport is not supported yet`.
Use the SDK's WebSocket client transport, with the same 10s timeout and cleanup. Test with a local fake server.
