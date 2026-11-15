import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverServers, normalizeServerName, transportOf } from "../src/discovery.js";

let root: string;
let home: string;
let project: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "leash-disc-")));
  home = join(root, "home");
  project = join(root, "proj");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v));

describe("discoverServers", () => {
  it("reads user scope from ~/.claude.json mcpServers", () => {
    writeJson(join(home, ".claude.json"), {
      mcpServers: { a: { command: "node", args: ["a.js"] } },
    });
    const { servers } = discoverServers({ home, project });
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: "a", scope: "user" });
    expect(servers[0]?.file).toBe(join(home, ".claude.json"));
  });

  it("reads local scope from ~/.claude.json projects[<abs path>].mcpServers", () => {
    writeJson(join(home, ".claude.json"), {
      projects: {
        [project]: { mcpServers: { b: { type: "http", url: "https://x.test/mcp" } } },
        "/some/other": { mcpServers: { nope: { command: "x" } } },
      },
    });
    const { servers } = discoverServers({ home, project });
    expect(servers.map((s) => s.name)).toEqual(["b"]);
    expect(servers[0]?.scope).toBe("local");
  });

  it("reads project scope from <project>/.mcp.json", () => {
    writeJson(join(project, ".mcp.json"), { mcpServers: { c: { command: "npx", args: ["c"] } } });
    const { servers } = discoverServers({ home, project });
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: "c", scope: "project" });
  });

  it("applies precedence local > project > user for same-named servers", () => {
    writeJson(join(home, ".claude.json"), {
      mcpServers: { dup: { command: "user" }, only_user: { command: "u" } },
      projects: { [project]: { mcpServers: { dup: { command: "local" } } } },
    });
    writeJson(join(project, ".mcp.json"), {
      mcpServers: { dup: { command: "project" }, p2: { command: "p" } },
    });
    const { servers } = discoverServers({ home, project });
    const dup = servers.find((s) => s.name === "dup");
    expect(dup?.scope).toBe("local");
    expect(dup?.config.command).toBe("local");
    expect(servers.map((s) => s.name).sort()).toEqual(["dup", "only_user", "p2"]);
  });

  it("returns nothing (no throw) when no config exists", () => {
    expect(discoverServers({ home, project })).toEqual({ servers: [], warnings: [] });
  });

  it("warns on invalid JSON instead of crashing", () => {
    writeFileSync(join(project, ".mcp.json"), "{ not json");
    const r = discoverServers({ home, project });
    expect(r.servers).toEqual([]);
    expect(r.warnings[0]).toMatch(/\.mcp\.json/);
  });

  it("ignores malformed server entries", () => {
    writeJson(join(project, ".mcp.json"), { mcpServers: { bad: "nope", ok: { command: "x" } } });
    expect(discoverServers({ home, project }).servers.map((s) => s.name)).toEqual(["ok"]);
  });

  it("never reads outside the supplied home", () => {
    // sanity: an empty temp home yields nothing even if a real ~/.claude.json exists
    expect(discoverServers({ home, project }).servers).toEqual([]);
  });
});

describe("normalizeServerName / transportOf", () => {
  it("replaces chars outside [A-Za-z0-9_-] with _", () => {
    expect(normalizeServerName("my.server name")).toBe("my_server_name");
    expect(normalizeServerName("ok-name_1")).toBe("ok-name_1");
  });

  it("infers transport", () => {
    expect(transportOf({ command: "x" })).toBe("stdio");
    expect(transportOf({ type: "stdio", command: "x" })).toBe("stdio");
    expect(transportOf({ type: "http", url: "u" })).toBe("http");
    expect(transportOf({ type: "sse", url: "u" })).toBe("sse");
    expect(transportOf({ type: "ws", url: "u" })).toBe("ws");
    expect(transportOf({ url: "u" })).toBe("http");
  });
});
