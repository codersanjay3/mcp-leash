import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist/cli.js");
const BASIC = join(ROOT, "test/fixtures/project-basic");
const OFFLINE = join(ROOT, "test/fixtures/project-offline");

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "leash-int-")));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(args: string[], opts: { input?: string; cmd?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" };
  env.MCP_LEASH_HOME = undefined;
  env.CLAUDE_CONFIG_DIR = undefined;
  const r = spawnSync("node", [opts.cmd ?? CLI, ...args], {
    env: Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as never,
    input: opts.input ?? "",
    encoding: "utf8",
    cwd: home,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const userSettings = () => join(home, ".claude", "settings.json");
const readSettings = () => JSON.parse(readFileSync(userSettings(), "utf8"));

const original = {
  model: "sonnet",
  permissions: { allow: ["Bash(ls:*)"], deny: ["Read(./.env)"] },
  hooks: {
    PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo done" }] }],
  },
};

function seedSettings() {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(userSettings(), `${JSON.stringify(original, null, 2)}\n`);
}

describe("scan", () => {
  it("finds and classifies all three fake tools, and survives a broken server", () => {
    const r = run(["scan", "--json", "--project", BASIC]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    const fake = j.servers.find((s: { name: string }) => s.name === "fake");
    const byName = Object.fromEntries(
      fake.tools.map((t: { name: string; risk: string }) => [t.name, t.risk]),
    );
    expect(byName).toEqual({ read_thing: "read", delete_thing: "critical", send_message: "write" });
    expect(fake.scope).toBe("project");
    const broken = j.servers.find((s: { name: string }) => s.name === "broken");
    expect(broken.error).toBeTruthy();
    expect(broken.tools).toEqual([]);
    expect(j.summary).toMatchObject({ servers: 2, tools: 3, critical: 1, write: 1, read: 1 });
  });

  it("pretty output has the summary line, could-not-connect and next step", () => {
    const r = run(["scan", "--project", BASIC]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/2 servers, 3 tools: 1 critical, 1 write, 1 read/);
    expect(r.out).toMatch(/could not connect/);
    expect(r.out).toMatch(/npx mcp-leash lock/);
  });

  it("--offline never spawns servers and uses presets only", () => {
    const r = run(["scan", "--offline", "--json", "--project", OFFLINE]);
    const j = JSON.parse(r.out);
    expect(j.servers.map((s: { name: string }) => s.name).sort()).toEqual(["files", "github"]);
    const gh = j.servers.find((s: { name: string }) => s.name === "github");
    expect(gh.source).toBe("preset");
    expect(gh.tools.find((t: { name: string }) => t.name === "merge_pull_request").risk).toBe(
      "critical",
    );
    const fake = run(["scan", "--offline", "--json", "--project", BASIC]);
    expect(JSON.parse(fake.out).summary.tools).toBe(0);
  });
});

describe("lock / unlock", () => {
  it("scan -> lock -> unlock restores the settings file exactly", () => {
    seedSettings();
    const before = readFileSync(userSettings(), "utf8");

    const lock = run(["lock", "--yes", "--project", BASIC]);
    expect(lock.code, lock.err + lock.out).toBe(0);

    const s = readSettings();
    expect(s.model).toBe("sonnet");
    expect(s.permissions.allow).toEqual(["Bash(ls:*)"]);
    expect(s.permissions.deny).toEqual(["Read(./.env)", "mcp__fake__delete_thing"]);
    expect(s.permissions.ask).toEqual(["mcp__fake__send_message"]);
    const hookCmd = `node "${join(home, ".mcp-leash", "hook.mjs")}"`;
    expect(s.hooks.PreToolUse).toEqual([
      { matcher: "mcp__.*", hooks: [{ type: "command", command: hookCmd }] },
    ]);
    expect(s.hooks.PostToolUse).toEqual(original.hooks.PostToolUse);
    expect(readFileSync(userSettings(), "utf8").endsWith("\n")).toBe(true);
    expect(readFileSync(userSettings(), "utf8")).toContain('\n  "permissions": {');

    // backup, hook copy, rules, state
    const bak = readdirSync(join(home, ".claude")).filter((f) =>
      f.startsWith("settings.json.mcp-leash.bak-"),
    );
    expect(bak).toHaveLength(1);
    expect(readFileSync(join(home, ".claude", bak[0] as string), "utf8")).toBe(before);
    expect(existsSync(join(home, ".mcp-leash", "hook.mjs"))).toBe(true);
    expect(existsSync(join(home, ".mcp-leash", "rules.json"))).toBe(true);
    const state = JSON.parse(readFileSync(join(home, ".mcp-leash", "state.json"), "utf8"));
    expect(state.files[userSettings()].deny).toEqual(["mcp__fake__delete_thing"]);

    // scan now reports existing status
    const scan = JSON.parse(run(["scan", "--json", "--project", BASIC]).out);
    const tools = scan.servers.find((x: { name: string }) => x.name === "fake").tools;
    const status = Object.fromEntries(
      tools.map((t: { name: string; status: string }) => [t.name, t.status]),
    );
    expect(status).toMatchObject({ delete_thing: "denied", send_message: "ask" });

    // idempotent
    const afterFirst = readFileSync(userSettings(), "utf8");
    const again = run(["lock", "--yes", "--project", BASIC]);
    expect(again.code).toBe(0);
    expect(readFileSync(userSettings(), "utf8")).toBe(afterFirst);

    // unlock
    const un = run(["unlock", "--yes"]);
    expect(un.code, un.err + un.out).toBe(0);
    expect(readSettings()).toEqual(original);
  });

  it("refuses to write without --yes when stdin is not a TTY", () => {
    seedSettings();
    const before = readFileSync(userSettings(), "utf8");
    const r = run(["lock", "--project", BASIC]);
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toMatch(/--yes/);
    expect(readFileSync(userSettings(), "utf8")).toBe(before);
    expect(existsSync(join(home, ".mcp-leash", "state.json"))).toBe(false);
  });

  it("--no-hook skips hook registration and copy", () => {
    run(["lock", "--yes", "--no-hook", "--project", BASIC]);
    const s = readSettings();
    expect(s.hooks).toBeUndefined();
    expect(existsSync(join(home, ".mcp-leash", "hook.mjs"))).toBe(false);
  });

  it("strict level also asks for unknown tools; project scope writes <project>/.claude", () => {
    const proj = join(home, "p");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, ".mcp.json"),
      JSON.stringify({ mcpServers: { github: { command: "npx", args: ["server-github"] } } }),
    );
    const r = run([
      "lock",
      "--yes",
      "--offline",
      "--scope",
      "project",
      "--level",
      "strict",
      "--project",
      proj,
    ]);
    expect(r.code, r.err + r.out).toBe(0);
    const s = JSON.parse(readFileSync(join(proj, ".claude", "settings.json"), "utf8"));
    expect(s.permissions.deny).toContain("mcp__github__merge_pull_request");
    expect(s.permissions.ask).toContain("mcp__github__create_issue");
    expect(existsSync(userSettings())).toBe(false);
  });

  it("lock --offline writes default argument rules from presets using real server names", () => {
    const r = run(["lock", "--yes", "--offline", "--project", OFFLINE]);
    expect(r.code, r.err + r.out).toBe(0);
    const rules = JSON.parse(readFileSync(join(home, ".mcp-leash", "rules.json"), "utf8"));
    const tools = rules.rules.map((x: { tool: string }) => x.tool);
    expect(tools).toContain("mcp__github__push_files");
    expect(tools).toContain("mcp__files__write_file");

    // never overwrites user edits
    const edited = { ...rules, rules: [] };
    writeFileSync(join(home, ".mcp-leash", "rules.json"), JSON.stringify(edited));
    run(["lock", "--yes", "--offline", "--project", OFFLINE]);
    expect(JSON.parse(readFileSync(join(home, ".mcp-leash", "rules.json"), "utf8")).rules).toEqual(
      [],
    );
  });
});

describe("built hook.mjs", () => {
  const HOOK = join(ROOT, "dist/hook.mjs");
  const input = (extra: object) =>
    JSON.stringify({
      session_id: "s",
      cwd: "/w",
      hook_event_name: "PreToolUse",
      tool_name: "mcp__github__push_files",
      tool_input: { branch: "main" },
      ...extra,
    });

  it("denies on match, stays silent otherwise, and has no package imports", () => {
    const leash = join(home, ".mcp-leash");
    mkdirSync(leash, { recursive: true });
    writeFileSync(
      join(leash, "rules.json"),
      JSON.stringify({
        rules: [
          {
            tool: "mcp__github__push_files",
            when: { branch: "^(main|master)$" },
            decision: "deny",
            reason: "No direct pushes to main",
          },
        ],
      }),
    );
    const hit = run([], { cmd: HOOK, input: input({}) });
    expect(hit.code).toBe(0);
    expect(JSON.parse(hit.out).hookSpecificOutput.permissionDecision).toBe("deny");
    const miss = run([], { cmd: HOOK, input: input({ tool_input: { branch: "dev" } }) });
    expect(miss.code).toBe(0);
    expect(miss.out).toBe("");

    const src = readFileSync(HOOK, "utf8");
    const specifiers = [
      ...src.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...src.matchAll(/\brequire\(\s*["']([^"']+)["']/g),
      ...src.matchAll(/\bimport\(\s*["']([^"']+)["']/g),
    ].map((m) => m[1] as string);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      // only Node builtins, never an installed package
      expect(builtinModules).toContain(spec.replace(/^node:/, ""));
    }
    expect(src).not.toMatch(/modelcontextprotocol/);
  });

  it("log command reads the audit trail", () => {
    const leash = join(home, ".mcp-leash");
    mkdirSync(leash, { recursive: true });
    run([], { cmd: HOOK, input: input({}) });
    const r = run(["log", "--json"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.entries[0]).toMatchObject({ server: "github", tool: "push_files" });
    expect(j.summary.github.calls).toBe(1);
  });
});
