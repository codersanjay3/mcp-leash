import { describe, expect, it } from "vitest";
import { defaultRulesFor, matchPreset, PRESETS, presetOfflineTools } from "../src/presets/index.js";

describe("matchPreset", () => {
  it("matches by server key", () => {
    expect(matchPreset("github", { command: "x" })?.id).toBe("github");
    expect(matchPreset("my-github", { command: "x" })?.id).toBe("github");
    expect(matchPreset("GitHub", { command: "x" })?.id).toBe("github");
    expect(matchPreset("filesystem", { command: "x" })?.id).toBe("filesystem");
  });

  it("does not match on loose substrings of the key", () => {
    expect(matchPreset("githubby", { command: "x" })).toBeUndefined();
    expect(matchPreset("slackish", { command: "x" })).toBeUndefined();
  });

  it("matches by command / args substring", () => {
    expect(
      matchPreset("gh", { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] })
        ?.id,
    ).toBe("github");
    expect(matchPreset("x", { command: "github-mcp-server", args: ["stdio"] })?.id).toBe("github");
    expect(
      matchPreset("x", {
        command: "npx",
        args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
      })?.id,
    ).toBe("filesystem");
  });

  it("matches by url substring", () => {
    expect(matchPreset("x", { type: "http", url: "https://api.githubcopilot.com/mcp/" })?.id).toBe(
      "github",
    );
    expect(matchPreset("x", { type: "http", url: "https://mcp.linear.app/sse" })?.id).toBe(
      "linear",
    );
    expect(matchPreset("x", { type: "http", url: "https://mcp.notion.com/mcp" })?.id).toBe(
      "notion",
    );
  });

  it("matches the git server by key or command", () => {
    expect(matchPreset("git", { command: "x" })?.id).toBe("git");
    expect(matchPreset("mcp-server-git", { command: "x" })?.id).toBe("git");
    expect(matchPreset("server-git", { command: "x" })?.id).toBe("git");
    expect(matchPreset("x", { command: "mcp-server-git", args: ["stdio"] })?.id).toBe("git");
    // The GitHub server still gets the GitHub preset, not the git one.
    expect(
      matchPreset("x", { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] })?.id,
    ).toBe("github");
  });

  it("returns undefined for unknown servers", () => {
    expect(matchPreset("weather", { command: "node", args: ["weather.js"] })).toBeUndefined();
  });
});

describe("preset coverage", () => {
  it("covers every server family the spec lists", () => {
    const ids = PRESETS.map((p) => p.id);
    for (const id of [
      "github",
      "git",
      "filesystem",
      "slack",
      "postgres",
      "sqlite",
      "supabase",
      "stripe",
      "notion",
      "linear",
      "puppeteer",
      "playwright",
      "docker",
      "kubernetes",
      "aws",
      "shell",
      "desktop-commander",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("every preset can enumerate tools for offline mode", () => {
    for (const p of PRESETS) {
      expect(presetOfflineTools(p).length).toBeGreaterThan(0);
    }
  });

  it("offline tool lists never contain glob entries", () => {
    for (const p of PRESETS) {
      for (const t of presetOfflineTools(p)) expect(t).not.toContain("*");
    }
  });

  it("git preset flags reset as critical and lists its tools offline", () => {
    const git = PRESETS.find((p) => p.id === "git");
    if (!git) throw new Error("missing");
    const tools = presetOfflineTools(git);
    expect(tools).toContain("git_reset");
    expect(tools).toContain("git_commit");
    expect(tools).toContain("git_add");
    expect(tools).toContain("git_checkout");
    expect(tools).toContain("git_create_branch");
    expect(tools).toContain("git_status");
    expect(tools).toContain("git_log");
    expect(tools).toContain("git_show");
  });

  it("github preset flags the dangerous ones", () => {
    const gh = PRESETS.find((p) => p.id === "github");
    const tools = gh ? presetOfflineTools(gh) : [];
    expect(tools).toContain("merge_pull_request");
    expect(tools).toContain("push_files");
    expect(tools).toContain("create_or_update_file");
    expect(tools).toContain("fork_repository");
  });
});

describe("defaultRulesFor", () => {
  it("github push to main/master asks, using the actual server name", () => {
    const gh = PRESETS.find((p) => p.id === "github");
    if (!gh) throw new Error("missing");
    const rules = defaultRulesFor(gh, "gh");
    const push = rules.find((r) => r.tool === "mcp__gh__push_files");
    expect(push).toMatchObject({ decision: "ask", when: { branch: "^(main|master)$" } });
    expect(rules.find((r) => r.tool === "mcp__gh__create_or_update_file")).toBeDefined();
  });

  it("filesystem write/edit/move outside cwd asks", () => {
    const fs = PRESETS.find((p) => p.id === "filesystem");
    if (!fs) throw new Error("missing");
    const rules = defaultRulesFor(fs, "files");
    expect(rules.find((r) => r.tool === "mcp__files__write_file")?.when).toEqual({ path: "!cwd" });
    expect(rules.find((r) => r.tool === "mcp__files__edit_file")).toBeDefined();
    expect(rules.filter((r) => r.tool === "mcp__files__move_file")).toHaveLength(2);
    expect(rules.every((r) => r.decision === "ask")).toBe(true);
  });

  it("normalises server names the way Claude Code does", () => {
    const gh = PRESETS.find((p) => p.id === "github");
    if (!gh) throw new Error("missing");
    expect(defaultRulesFor(gh, "my.github server")[0]?.tool).toMatch(/^mcp__my_github_server__/);
  });
});
