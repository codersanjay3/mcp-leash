# Contributing

Thanks for helping. This is a small project; the bar is "tests pass and the change is easy to review".

## Setup

```sh
git clone https://github.com/codersanjay3/mcp-leash
cd mcp-leash
npm install
npm run lint && npm test && npm run build
```

Requires Node 18 or newer.

## Ground rules

- **Never touch the real home directory in tests.** Tests use temp directories and the
  `HOME` / `MCP_LEASH_HOME` overrides. A test that reads or writes the real `~/.claude`,
  `~/.claude.json` or `~/.mcp-leash` will be rejected.
- **Test first.** Add a failing test, then the change. Unit tests live in `test/*.test.ts`;
  the integration test (`test/integration.test.ts`) drives the built CLI against the fake
  MCP server in `test/fixtures`.
- **The hook stays tiny.** `src/hook-core.ts` and `src/hook.ts` may only import Node
  built-ins and must not pull in the MCP SDK or any package. A test greps the built
  `dist/hook.mjs` for this.
- Keep Claude Code facts in `docs/SPEC.md` accurate. If Claude Code changes, update the spec
  and the code together.

## Adding a preset

Presets are in `src/presets/`. A preset has `keys` (server names), `hints` (substrings of the
command or URL), and `critical` / `write` / `read` tool lists. Entries without `*` are also used
by `--offline`; entries with `*` are globs. Optional `rules` are default hook rules; use
`{server}` in the tool name. Add a test in `test/presets.test.ts` and `test/classifier.test.ts`.

## Pull requests

- One topic per PR; describe what changed and why.
- Update `CHANGELOG.md` under "Unreleased" for user-visible changes.
- `npm run lint`, `npm test` and `npm run build` must pass (CI runs them on Node 18/20/22,
  Ubuntu and macOS).
