import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  argsPreview,
  evaluateRules,
  findNestedQuantifiers,
  globToRegExp,
  parseToolName,
  redact,
  runHook,
} from "../src/hook-core.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leash-hook-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const rules = (r: unknown) => writeFileSync(join(dir, "rules.json"), JSON.stringify(r));
const call = (input: unknown) => runHook({ stdin: JSON.stringify(input), leashHome: dir });
const audit = () =>
  readFileSync(join(dir, "audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

const pushMain = {
  session_id: "s1",
  cwd: "/work/proj",
  hook_event_name: "PreToolUse",
  tool_name: "mcp__github__push_files",
  tool_input: { owner: "o", repo: "r", branch: "main", files: [] },
};

describe("globToRegExp / parseToolName", () => {
  it("globs with *", () => {
    expect(globToRegExp("mcp__github__*").test("mcp__github__push_files")).toBe(true);
    expect(globToRegExp("mcp__github__*").test("mcp__gitlab__push_files")).toBe(false);
    expect(globToRegExp("mcp__*__delete_*").test("mcp__x__delete_y")).toBe(true);
    expect(globToRegExp("mcp__a.b__c").test("mcp__aXb__c")).toBe(false);
  });
  it("splits server and tool", () => {
    expect(parseToolName("mcp__github__push_files")).toEqual({
      server: "github",
      tool: "push_files",
    });
    expect(parseToolName("mcp__plugin_x_y__do_it")).toEqual({
      server: "plugin_x_y",
      tool: "do_it",
    });
    expect(parseToolName("Bash")).toEqual({ server: "", tool: "Bash" });
  });
});

describe("redact / argsPreview", () => {
  it("redacts values whose keys match token|secret|password|key|auth", () => {
    const out = redact({
      apiKey: "abc",
      GITHUB_TOKEN: "t",
      password: "p",
      client_secret: "s",
      Authorization: "Bearer x",
      branch: "main",
      nested: { api_key: "k", ok: 1 },
      list: [{ token: "z" }],
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.GITHUB_TOKEN).toBe("[REDACTED]");
    expect(out.password).toBe("[REDACTED]");
    expect(out.client_secret).toBe("[REDACTED]");
    expect(out.Authorization).toBe("[REDACTED]");
    expect(out.branch).toBe("main");
    expect(out.nested).toEqual({ api_key: "[REDACTED]", ok: 1 });
    expect(out.list).toEqual([{ token: "[REDACTED]" }]);
  });

  it("redacts well-known token shapes inside plain strings", () => {
    const out = redact({ note: "use ghp_abcdefghijklmnopqrstuvwxyz0123456789 now" }) as {
      note: string;
    };
    expect(out.note).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("caps previews at 300 chars", () => {
    const p = argsPreview({ text: "x".repeat(1000) });
    expect(p.length).toBeLessThanOrEqual(300);
  });

  it("never leaks a secret into the preview", () => {
    expect(argsPreview({ password: "hunter2", a: 1 })).not.toContain("hunter2");
  });

  it("handles cycles and non-objects", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => argsPreview(a)).not.toThrow();
    expect(argsPreview(undefined)).toBe("");
    expect(argsPreview("plain")).toBe('"plain"');
  });
});

describe("evaluateRules", () => {
  const r = [
    {
      tool: "mcp__github__push_files",
      when: { branch: "^(main|master)$" },
      decision: "deny" as const,
      reason: "no main",
    },
    { tool: "mcp__github__*", decision: "ask" as const },
  ];
  it("first matching rule wins", () => {
    expect(evaluateRules(pushMain, r)?.decision).toBe("deny");
  });
  it("when entries are ANDed", () => {
    const rr = [{ tool: "*", when: { a: "^1$", b: "^2$" }, decision: "deny" as const }];
    expect(evaluateRules({ tool_name: "t", tool_input: { a: 1, b: 2 } }, rr)).toBeDefined();
    expect(evaluateRules({ tool_name: "t", tool_input: { a: 1, b: 3 } }, rr)).toBeUndefined();
  });
  it("missing arg means no match", () => {
    const rr = [{ tool: "*", when: { branch: ".*" }, decision: "deny" as const }];
    expect(evaluateRules({ tool_name: "t", tool_input: {} }, rr)).toBeUndefined();
  });
  it("no match returns undefined", () => {
    expect(
      evaluateRules({ ...pushMain, tool_input: { branch: "feature/x" } }, [r[0] as never]),
    ).toBeUndefined();
  });
  it("!cwd matches paths outside the session cwd, resolving relatives against it", () => {
    const rr = [{ tool: "*", when: { path: "!cwd" }, decision: "ask" as const }];
    const ev = (p: string) =>
      evaluateRules({ tool_name: "t", cwd: "/work/proj", tool_input: { path: p } }, rr);
    expect(ev("/etc/passwd")).toBeDefined();
    expect(ev("../other/x")).toBeDefined();
    expect(ev("/work/proj-evil/x")).toBeDefined();
    expect(ev("/work/proj/src/a.ts")).toBeUndefined();
    expect(ev("src/a.ts")).toBeUndefined();
    expect(ev("/work/proj")).toBeUndefined();
  });
  it("non-string args are stringified for matching", () => {
    const rr = [{ tool: "*", when: { force: "^true$" }, decision: "deny" as const }];
    expect(evaluateRules({ tool_name: "t", tool_input: { force: true } }, rr)).toBeDefined();
  });
});

describe("runHook", () => {
  it("denies on a rule match with the documented JSON output and exit 0", () => {
    rules({
      rules: [
        {
          tool: "mcp__github__push_files",
          when: { branch: "^(main|master)$" },
          decision: "deny",
          reason: "No direct pushes to main",
        },
      ],
    });
    const r = call(pushMain);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "mcp-leash: No direct pushes to main",
      },
    });
  });

  it("supports ask", () => {
    rules({ rules: [{ tool: "mcp__github__*", decision: "ask" }] });
    const out = JSON.parse(call(pushMain).stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("prints nothing and exits 0 when no rule matches", () => {
    rules({
      rules: [{ tool: "mcp__github__push_files", when: { branch: "^main$" }, decision: "deny" }],
    });
    const r = call({ ...pushMain, tool_input: { branch: "feature" } });
    expect(r).toEqual({ stdout: "", stderr: "", code: 0 });
  });

  it("works with no rules.json at all", () => {
    expect(call(pushMain)).toEqual({ stdout: "", stderr: "", code: 0 });
  });

  it("writes a redacted audit line for allowed and denied calls", () => {
    rules({
      rules: [
        {
          tool: "mcp__github__push_files",
          when: { branch: "^main$" },
          decision: "deny",
          reason: "r",
        },
      ],
    });
    call({ ...pushMain, tool_input: { branch: "main", token: "SECRET123" } });
    call({ ...pushMain, tool_name: "mcp__slack__post", tool_input: { text: "hi" } });
    const lines = audit();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      session_id: "s1",
      cwd: "/work/proj",
      tool_name: "mcp__github__push_files",
      server: "github",
      tool: "push_files",
      decision: "deny",
      rule: "mcp__github__push_files",
    });
    expect(typeof lines[0].ts).toBe("string");
    expect(JSON.stringify(lines[0])).not.toContain("SECRET123");
    expect(lines[0].args_preview.length).toBeLessThanOrEqual(300);
    expect(lines[1]).toMatchObject({ server: "slack", tool: "post", decision: "none", rule: null });
  });

  it("fail-open: malformed stdin -> stderr, exit 0, no stdout", () => {
    const r = runHook({ stdin: "{{{", leashHome: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/mcp-leash/);
  });

  it("fail-open: invalid regex in rules -> stderr, exit 0, no stdout", () => {
    rules({ rules: [{ tool: "*", when: { branch: "(" }, decision: "deny" }] });
    const r = call(pushMain);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toBe("");
  });

  it("failClosed: errors deny instead", () => {
    rules({ failClosed: true, rules: [{ tool: "*", when: { branch: "(" }, decision: "deny" }] });
    const r = call(pushMain);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("an unwritable audit log never changes the decision", () => {
    rules({ rules: [{ tool: "*", decision: "deny" }] });
    const r = runHook({
      stdin: JSON.stringify(pushMain),
      leashHome: join(dir, "rules.json", "nope"),
    });
    expect(r.code).toBe(0);
  });
});

describe("per-rule isolation and independent audit", () => {
  it("an invalid regex skips only that rule: later rules still apply and the audit is written", () => {
    rules({
      rules: [
        { tool: "*", when: { branch: "(" }, decision: "ask" },
        { tool: "mcp__github__push_files", when: { branch: "^main$" }, decision: "deny" },
      ],
    });
    const r = call(pushMain);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(r.stderr).toMatch(/skipping rule/);
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({ decision: "deny" });
  });

  it("writes the audit line even when rules.json is unreadable (fail-open)", () => {
    writeFileSync(join(dir, "rules.json"), "{not json");
    const r = call(pushMain);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/rules/);
    expect(audit()).toHaveLength(1);
  });

  it("a malformed rule entry does not stop evaluation", () => {
    rules({ rules: [null, { tool: "mcp__github__*", decision: "ask" }] });
    const r = call(pushMain);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("ask");
  });
});

describe("ReDoS defenses", () => {
  it("only tests the first 2048 chars of an argument", () => {
    const rr = [{ tool: "*", when: { text: "b$" }, decision: "deny" as const }];
    const long = `${"a".repeat(3000)}b`;
    expect(evaluateRules({ tool_name: "t", tool_input: { text: long } }, rr)).toBeUndefined();
    expect(evaluateRules({ tool_name: "t", tool_input: { text: "ab" } }, rr)).toBeDefined();
  });

  it("flags nested quantifiers like (x+)+ but not ordinary patterns", () => {
    expect(findNestedQuantifiers("^(a+)+$")).toBe(true);
    expect(findNestedQuantifiers("(a*)*")).toBe(true);
    expect(findNestedQuantifiers("^(\\w+\\s?)*$")).toBe(true);
    expect(findNestedQuantifiers("(.*)+x")).toBe(true);
    expect(findNestedQuantifiers("^(main|master)$")).toBe(false);
    expect(findNestedQuantifiers("^feature/.+$")).toBe(false);
    expect(findNestedQuantifiers("(ab)+")).toBe(false);
  });
});

describe("more redaction", () => {
  it("redacts scheme://user:pass@ credentials and Bearer tokens anywhere", () => {
    const out = JSON.stringify(
      redact({
        url: "postgres://admin:hunter2@db.example.com:5432/app",
        nested: [{ cmd: "curl -H 'Authorization: Bearer abc.def-123_xyz' https://x" }],
        plain: "https://example.com/path",
      }),
    );
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("abc.def-123_xyz");
    expect(out).toContain("db.example.com");
    expect(out).toContain("https://example.com/path");
    expect(redact("Bearer sometoken123")).not.toContain("sometoken123");
  });

  it("creates audit.jsonl with mode 0600", () => {
    call(pushMain);
    expect(statSync(join(dir, "audit.jsonl")).mode & 0o777).toBe(0o600);
  });
});

describe("misc hook parsing", () => {
  it("!cwd treats ~ paths as outside cwd", () => {
    const rr = [{ tool: "*", when: { path: "!cwd" }, decision: "ask" as const }];
    const ev = (p: string) =>
      evaluateRules({ tool_name: "t", cwd: "/work/proj", tool_input: { path: p } }, rr);
    expect(ev("~/.ssh/id_rsa")).toBeDefined();
    expect(ev("~")).toBeDefined();
    expect(ev("src/~notes.txt")).toBeUndefined();
  });

  it("parseToolName prefers a known server list when names contain __", () => {
    expect(parseToolName("mcp__a__b__tool", ["a__b", "a"])).toEqual({
      server: "a__b",
      tool: "tool",
    });
    expect(parseToolName("mcp__a__tool", ["a__b", "a"])).toEqual({ server: "a", tool: "tool" });
    expect(parseToolName("mcp__zzz__tool", ["a"])).toEqual({ server: "zzz", tool: "tool" });
  });

  it("uses the optional servers list from rules.json in the audit line", () => {
    rules({ servers: ["my__srv"], rules: [] });
    call({ ...pushMain, tool_name: "mcp__my__srv__do_it" });
    expect(audit()[0]).toMatchObject({ server: "my__srv", tool: "do_it" });
  });
});
