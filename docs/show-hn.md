# Show HN draft

**Title:** Show HN: mcp-leash – find the dangerous tools in your MCP servers and lock them down

**Body:**

I use Claude Code with a handful of MCP servers, and at some point I realised I had never
actually read what tools they expose. Some of them can delete branches, run shell commands,
or message people as me, and I had mostly been clicking through permission prompts.

mcp-leash is a small CLI that does three things:

1. `npx mcp-leash scan` connects to every MCP server in your Claude Code config (user, local
   and project scope), lists the tools and ranks each as critical / write / read / unknown,
   with the reason (preset for well-known servers, MCP annotations, then verbs in the name).
2. `npx mcp-leash lock` writes the matching deny/ask permission rules into your Claude Code
   settings. It shows a diff first, backs up the file, never removes your own rules, and
   `unlock` removes exactly what it added.
3. Claude Code can't filter on arguments in permission rules (`mcp__` rules with parentheses
   are skipped), so lock also registers a tiny PreToolUse hook. It's a single dependency-free
   file that reads `~/.mcp-leash/rules.json` ("ask before pushing to main", "ask before
   writing outside the project") and keeps a redacted audit log you can read with `mcp-leash log`.

The hook is fail-open: if it errors it exits 0 and gets out of the way, so it can't brick your
workflow. There's an opt-in `failClosed`.

Limits: Claude Code only for now; `scan` has to start your servers to list tools (so don't
point it at a repo you don't trust; `--offline` uses presets only); a hook `ask` is a prompt, not
a sandbox. Presets cover GitHub, filesystem, Slack, Postgres/SQLite/Supabase, Stripe, Notion,
Linear, Puppeteer/Playwright, Docker, Kubernetes, AWS and shell servers, and PRs for more
are very welcome.

Repo: https://github.com/codersanjay3/mcp-leash

Things I'd like feedback on: the critical/write split, the default rules, and which other
clients are worth supporting.
