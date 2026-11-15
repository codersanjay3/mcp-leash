import { describe, expect, it } from "vitest";
import { analyze, parseInput, parseToolLines, presetExamples, run } from "../site/core.js";
import { classifyTool } from "../src/classifier.js";
import { fullToolName } from "../src/names.js";
import { planAdditions } from "../src/plan.js";
import { github } from "../src/presets/github.js";
import { matchPreset, presetOfflineTools } from "../src/presets/index.js";

describe("site core: GitHub preset example", () => {
  const ex = presetExamples().find((e) => e.id === "github");
  const a = run(ex?.serverName ?? "", (ex?.tools ?? []).join("\n"), "balanced");
  const row = (n: string) => a.rows.find((r) => r.name === n);

  it("denies delete_repository and asks for push_files", () => {
    expect(row("delete_repository")?.action).toBe("deny");
    expect(row("push_files")?.action).toBe("ask");
    expect(row("get_issue")?.action).toBe("none");
    expect(a.plan.deny).toContain("mcp__github__delete_repository");
    expect(a.plan.ask).toContain("mcp__github__push_files");
  });

  it("matches the CLI classifier and planner exactly", () => {
    const tools = presetOfflineTools(github).map((name) => {
      const c = classifyTool({ name }, matchPreset("github", {}));
      return {
        name,
        fullName: fullToolName("github", name),
        risk: c.risk,
        reason: c.reason,
        server: "github",
      };
    });
    const cli = planAdditions(tools, "balanced", { deny: [], ask: [], allow: [] });
    expect(a.plan).toEqual(cli);
    for (const t of tools) {
      expect(row(t.name)?.risk).toBe(t.risk);
      expect(row(t.name)?.reason).toBe(t.reason);
    }
  });

  it("emits the permissions snippet", () => {
    const parsed = JSON.parse(a.snippet ?? "{}");
    expect(parsed.permissions.deny).toContain("mcp__github__delete_repository");
    expect(parsed.permissions.ask).toContain("mcp__github__push_files");
  });
});

describe("site core: input handling", () => {
  it("strict asks for unknown tools, balanced does not", () => {
    const text = "frobnicate_widget";
    expect(run("zzz", text, "balanced").rows[0]?.action).toBe("none");
    expect(run("zzz", text, "strict").rows[0]?.action).toBe("ask");
    expect(run("zzz", text, "strict").rows[0]?.risk).toBe("unknown");
  });

  it("parses lines with bullets, blanks and duplicates", () => {
    expect(parseToolLines("- a\n\n* b\n1. c\na\n")).toEqual(["a", "b", "c"]);
  });

  it("auto-detects scan --json and reuses its classification", () => {
    const json = JSON.stringify({
      servers: [
        {
          name: "my.srv",
          preset: null,
          tools: [
            { name: "nuke", risk: "critical", reason: 'verb "nuke"' },
            { name: "look", risk: "read", reason: "readOnlyHint:true" },
          ],
        },
      ],
    });
    const p = parseInput("ignored", json);
    expect(p.detected).toBe("json");
    const a = analyze(p, "balanced");
    expect(a.rows.map((r) => [r.fullName, r.action])).toEqual([
      ["mcp__my_srv__nuke", "deny"],
      ["mcp__my_srv__look", "none"],
    ]);
  });

  it("reports bad JSON without throwing", () => {
    expect(run("x", "{ nope", "balanced").error).toMatch(/does not parse/);
    expect(run("x", '{"a":1}', "balanced").error).toMatch(/servers/);
  });

  it("has an example for every preset, with no globs", () => {
    const ex = presetExamples();
    expect(ex.length).toBeGreaterThan(10);
    for (const e of ex) {
      expect(e.tools.length).toBeGreaterThan(0);
      expect(e.tools.some((t) => t.includes("*"))).toBe(false);
    }
  });
});
