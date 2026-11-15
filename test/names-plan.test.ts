import { describe, expect, it } from "vitest";
import * as discovery from "../src/discovery.js";
import { fullToolName, normalizeServerName } from "../src/names.js";
import { planAdditions, type RuleSets, ruleCovers } from "../src/plan.js";
import * as settings from "../src/settings.js";

const none: RuleSets = { deny: [], ask: [], allow: [] };

describe("names", () => {
  it("normalizes server and tool names", () => {
    expect(normalizeServerName("my.server name")).toBe("my_server_name");
    expect(fullToolName("my.server", "do.thing")).toBe("mcp__my_server__do_thing");
  });
  it("old locations re-export the same functions", () => {
    expect(discovery.normalizeServerName).toBe(normalizeServerName);
    expect(settings.fullToolName).toBe(fullToolName);
    expect(settings.planAdditions).toBe(planAdditions);
    expect(settings.ruleCovers).toBe(ruleCovers);
  });
});

describe("plan", () => {
  const tools = [
    { fullName: "mcp__s__rm", risk: "critical" as const, server: "s" },
    { fullName: "mcp__s__put", risk: "write" as const, server: "s" },
    { fullName: "mcp__s__get", risk: "read" as const, server: "s" },
    { fullName: "mcp__s__odd", risk: "unknown" as const, server: "s" },
  ];
  it("balanced: deny critical, ask write", () => {
    expect(planAdditions(tools, "balanced", none)).toEqual({
      deny: ["mcp__s__rm"],
      ask: ["mcp__s__put"],
    });
  });
  it("strict also asks unknown", () => {
    expect(planAdditions(tools, "strict", none).ask).toEqual(["mcp__s__put", "mcp__s__odd"]);
  });
  it("skips tools already covered, never asks when denied", () => {
    const existing: RuleSets = { deny: ["mcp__s__*"], ask: [], allow: [] };
    expect(planAdditions(tools, "strict", existing)).toEqual({ deny: [], ask: [] });
  });
  it("ruleCovers handles exact, wildcard and bare server rules", () => {
    expect(ruleCovers("mcp__s__rm", "mcp__s__rm")).toBe(true);
    expect(ruleCovers("mcp__s", "mcp__s__rm")).toBe(true);
    expect(ruleCovers("mcp__s__*", "mcp__s__rm")).toBe(true);
    expect(ruleCovers("mcp__t__*", "mcp__s__rm")).toBe(false);
    expect(ruleCovers("mcp__s__rm(x)", "mcp__s__rm")).toBe(false);
  });
});
