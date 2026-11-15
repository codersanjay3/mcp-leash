import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowOverrides,
  fullToolName,
  type LockRecord,
  mergeRecords,
  mergeSettings,
  planAdditions,
  readSettingsFile,
  ruleCovers,
  toolStatus,
  unmergeSettings,
  writeJsonAtomic,
} from "../src/settings.js";

const HOOK = { matcher: "mcp__.*", command: 'node "/h/.mcp-leash/hook.mjs"' };

describe("ruleCovers", () => {
  it("matches exact, server wildcard, and bare server rules", () => {
    expect(ruleCovers("mcp__a__b", "mcp__a__b")).toBe(true);
    expect(ruleCovers("mcp__a__*", "mcp__a__b")).toBe(true);
    expect(ruleCovers("mcp__a", "mcp__a__b")).toBe(true);
    expect(ruleCovers("mcp__a__c", "mcp__a__b")).toBe(false);
    expect(ruleCovers("mcp__ab__*", "mcp__a__b")).toBe(false);
    expect(ruleCovers("Bash(rm:*)", "mcp__a__b")).toBe(false);
  });
});

describe("toolStatus", () => {
  it("applies deny > ask > allow", () => {
    const rules = { deny: ["mcp__a__d"], ask: ["mcp__a__d", "mcp__a__q"], allow: ["mcp__a__*"] };
    expect(toolStatus("mcp__a__d", rules)).toBe("denied");
    expect(toolStatus("mcp__a__q", rules)).toBe("ask");
    expect(toolStatus("mcp__a__z", rules)).toBe("allowed");
    expect(toolStatus("mcp__b__z", rules)).toBeUndefined();
  });
});

describe("planAdditions", () => {
  const tools = [
    { fullName: "mcp__s__del", risk: "critical" as const },
    { fullName: "mcp__s__send", risk: "write" as const },
    { fullName: "mcp__s__get", risk: "read" as const },
    { fullName: "mcp__s__odd", risk: "unknown" as const },
  ];
  const none = { deny: [], ask: [], allow: [] };

  it("balanced: critical deny, write ask, rest untouched", () => {
    expect(planAdditions(tools, "balanced", none)).toEqual({
      deny: ["mcp__s__del"],
      ask: ["mcp__s__send"],
    });
  });

  it("strict: critical deny, write and unknown ask", () => {
    expect(planAdditions(tools, "strict", none)).toEqual({
      deny: ["mcp__s__del"],
      ask: ["mcp__s__send", "mcp__s__odd"],
    });
  });

  it("does not add ask when the tool already has a deny (exact or wildcard)", () => {
    expect(planAdditions(tools, "balanced", { ...none, deny: ["mcp__s__send"] }).ask).toEqual([]);
    expect(planAdditions(tools, "balanced", { ...none, deny: ["mcp__s__*"] })).toEqual({
      deny: [],
      ask: [],
    });
  });

  it("dedupes against existing rules", () => {
    expect(
      planAdditions(tools, "balanced", { ...none, deny: ["mcp__s__del"], ask: ["mcp__s__send"] }),
    ).toEqual({ deny: [], ask: [] });
  });

  it("still denies a critical tool that is only in ask or allow", () => {
    expect(
      planAdditions(tools, "balanced", { ...none, ask: ["mcp__s__del"], allow: ["mcp__s__del"] })
        .deny,
    ).toEqual(["mcp__s__del"]);
  });
});

describe("mergeSettings", () => {
  const base = {
    theme: "dark",
    permissions: { allow: ["Bash(ls:*)"], deny: ["Read(.env)"], defaultMode: "default" },
    hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "fmt" }] }] },
  };

  it("keeps existing keys/rules/order and appends", () => {
    const { settings, added } = mergeSettings(
      base,
      { deny: ["mcp__s__del"], ask: ["mcp__s__send"] },
      HOOK,
    );
    expect(settings.theme).toBe("dark");
    expect(settings.permissions?.allow).toEqual(["Bash(ls:*)"]);
    expect(settings.permissions?.deny).toEqual(["Read(.env)", "mcp__s__del"]);
    expect(settings.permissions?.ask).toEqual(["mcp__s__send"]);
    expect(settings.permissions?.defaultMode).toBe("default");
    expect(settings.hooks?.PostToolUse).toEqual(base.hooks.PostToolUse);
    expect(settings.hooks?.PreToolUse).toEqual([
      { matcher: "mcp__.*", hooks: [{ type: "command", command: HOOK.command }] },
    ]);
    expect(added).toEqual({ deny: ["mcp__s__del"], ask: ["mcp__s__send"], hook: HOOK });
  });

  it("does not mutate its input", () => {
    const copy = structuredClone(base);
    mergeSettings(base, { deny: ["x"], ask: [] }, HOOK);
    expect(base).toEqual(copy);
  });

  it("works on an empty settings object", () => {
    const { settings } = mergeSettings({}, { deny: ["a"], ask: [] }, undefined);
    expect(settings).toEqual({ permissions: { deny: ["a"] } });
  });

  it("is idempotent: second merge adds nothing and no duplicate hook", () => {
    const first = mergeSettings(base, { deny: ["d"], ask: ["a"] }, HOOK);
    const second = mergeSettings(first.settings, { deny: ["d"], ask: ["a"] }, HOOK);
    expect(second.settings).toEqual(first.settings);
    expect(second.added).toEqual({ deny: [], ask: [], hook: undefined });
  });

  it("does not register the hook again if the same command is already present anywhere", () => {
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: "mcp__.*", hooks: [{ type: "command", command: HOOK.command }] }],
      },
    };
    const { settings, added } = mergeSettings(existing, { deny: [], ask: [] }, HOOK);
    expect(settings).toEqual(existing);
    expect(added.hook).toBeUndefined();
  });

  it("leaves other PreToolUse groups alone", () => {
    const existing = {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] }] },
    };
    const { settings } = mergeSettings(existing, { deny: [], ask: [] }, HOOK);
    expect(settings.hooks?.PreToolUse).toHaveLength(2);
    expect(settings.hooks?.PreToolUse?.[0]).toEqual(existing.hooks.PreToolUse[0]);
  });
});

describe("unmergeSettings", () => {
  it("restores the original after merge (round trip)", () => {
    const base = {
      permissions: { allow: ["a"], deny: ["Read(.env)"] },
      hooks: { PostToolUse: [{ matcher: "E", hooks: [{ type: "command", command: "f" }] }] },
      other: 1,
    };
    const { settings, added } = mergeSettings(
      base,
      { deny: ["mcp__s__del"], ask: ["mcp__s__send"] },
      HOOK,
    );
    expect(unmergeSettings(settings, added)).toEqual(base);
  });

  it("round-trips an empty file back to empty", () => {
    const { settings, added } = mergeSettings({}, { deny: ["d"], ask: ["a"] }, HOOK);
    expect(unmergeSettings(settings, added)).toEqual({});
  });

  it("removes only recorded entries; keeps user-added ones and user-owned duplicates", () => {
    const record: LockRecord = { deny: ["mcp__s__del"], ask: [], hook: HOOK };
    const current = {
      permissions: { deny: ["mcp__s__del", "mcp__user__rule"], ask: ["mcp__s__send"] },
      hooks: {
        PreToolUse: [
          {
            matcher: "mcp__.*",
            hooks: [
              { type: "command", command: "userhook" },
              { type: "command", command: HOOK.command },
            ],
          },
        ],
      },
    };
    const out = unmergeSettings(current, record);
    expect(out.permissions?.deny).toEqual(["mcp__user__rule"]);
    expect(out.permissions?.ask).toEqual(["mcp__s__send"]);
    expect(out.hooks?.PreToolUse).toEqual([
      { matcher: "mcp__.*", hooks: [{ type: "command", command: "userhook" }] },
    ]);
  });

  it("is a no-op for entries that were already removed by hand", () => {
    const out = unmergeSettings(
      { permissions: { allow: ["x"] } },
      { deny: ["gone"], ask: ["g2"], hook: HOOK },
    );
    expect(out).toEqual({ permissions: { allow: ["x"] } });
  });
});

describe("mergeRecords", () => {
  it("unions rules and keeps the hook if either recorded it", () => {
    const m = mergeRecords(
      { deny: ["a"], ask: ["b"], hook: undefined },
      { deny: ["a", "c"], ask: [], hook: HOOK },
    );
    expect(m).toEqual({ deny: ["a", "c"], ask: ["b"], hook: HOOK });
  });
});

describe("writeJsonAtomic", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "leash-atomic-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes through a symlink instead of replacing it, keeping the target's mode", () => {
    const real = join(dir, "dotfiles", "settings.json");
    mkdirSync(join(dir, "dotfiles"));
    writeFileSync(real, "{}\n", { mode: 0o600 });
    chmodSync(real, 0o600);
    const link = join(dir, "settings.json");
    symlinkSync(real, link);

    writeJsonAtomic(link, { a: 1 });

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({ a: 1 });
    expect(statSync(real).mode & 0o777).toBe(0o600);
  });

  it("preserves the mode of an existing regular file", () => {
    const f = join(dir, "s.json");
    writeFileSync(f, "{}");
    chmodSync(f, 0o640);
    writeJsonAtomic(f, { a: 1 });
    expect(statSync(f).mode & 0o777).toBe(0o640);
  });

  it("creates new files private (0600)", () => {
    const f = join(dir, "new", "s.json");
    writeJsonAtomic(f, { a: 1 });
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });
});

describe("readSettingsFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leash-read-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("strips a UTF-8 BOM", () => {
    const f = join(dir, "s.json");
    writeFileSync(f, `\uFEFF${JSON.stringify({ model: "x" })}`);
    expect(readSettingsFile(f)).toEqual({ model: "x" });
  });
});

describe("fullToolName", () => {
  it("normalizes both the server and the tool name", () => {
    expect(fullToolName("my.server", "do.thing v2")).toBe("mcp__my_server__do_thing_v2");
    expect(fullToolName("ok-srv", "ok_tool-1")).toBe("mcp__ok-srv__ok_tool-1");
  });
});

describe("ruleCovers with a known server containing __", () => {
  it("uses the supplied server instead of splitting the name", () => {
    const full = "mcp__a__b__tool";
    expect(ruleCovers("mcp__a__b__*", full, "a__b")).toBe(true);
    expect(ruleCovers("mcp__a__b", full, "a__b")).toBe(true);
    expect(ruleCovers("mcp__a__*", full, "a__b")).toBe(false);
  });
});

describe("mergeSettings guards", () => {
  it("throws on non-array permissions values instead of corrupting them", () => {
    const bad = { permissions: { ask: "mcp__x__y" } } as never;
    expect(() => mergeSettings(bad, { deny: [], ask: ["mcp__s__send"] }, undefined)).toThrow(
      /permissions\.ask/,
    );
    const badPerms = { permissions: ["x"] } as never;
    expect(() => mergeSettings(badPerms, { deny: ["mcp__s__d"], ask: [] }, undefined)).toThrow(
      /permissions/,
    );
  });
  it("throws on a non-array hooks.PreToolUse", () => {
    const bad = { hooks: { PreToolUse: {} } } as never;
    expect(() => mergeSettings(bad, { deny: [], ask: [] }, HOOK)).toThrow(/PreToolUse/);
  });
});

describe("allowOverrides", () => {
  it("lists added deny/ask rules that shadow an existing allow rule", () => {
    const existing = { deny: [], ask: [], allow: ["mcp__s__*", "mcp__t__x", "Bash(ls:*)"] };
    const adds = { deny: ["mcp__t__x"], ask: ["mcp__s__send", "mcp__u__y"] };
    expect(allowOverrides(adds, existing)).toEqual([
      { tool: "mcp__t__x", rule: "mcp__t__x" },
      { tool: "mcp__s__send", rule: "mcp__s__*" },
    ]);
  });
});
