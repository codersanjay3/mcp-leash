import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logCommand } from "../src/cmd-log.js";
import type { Ctx } from "../src/paths.js";

let ctx: Ctx;
const now = new Date("2026-11-15T12:00:00Z");
const hour = 3_600_000;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "leash-log-"));
  ctx = { home, leashHome: join(home, ".mcp-leash") };
  mkdirSync(ctx.leashHome);
  const entries = [49, 25, 2, 1, 0].map((hours) => ({
    ts: new Date(now.getTime() - hours * hour).toISOString(),
    session_id: null,
    cwd: null,
    tool_name: "mcp__fake__read",
    server: "fake",
    tool: "read",
    args_preview: "",
    decision: "none",
    rule: null,
  }));
  writeFileSync(
    join(ctx.leashHome, "audit.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n"),
  );
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(ctx.home, { recursive: true, force: true });
});

function result() {
  return JSON.parse(vi.mocked(console.log).mock.calls[0][0] as string);
}

describe("log --since", () => {
  it.each([
    ["1h", 2],
    ["2d", 4],
    ["60m", 2],
    ["3600s", 2],
  ])("includes the cutoff when filtering %s", async (duration, count) => {
    expect(await logCommand(["--since", duration as string, "--json"], ctx)).toBe(0);
    expect(result().entries).toHaveLength(count as number);
    expect(result().summary.fake.calls).toBe(count);
  });

  it("combines with --today and applies the limit after filtering", async () => {
    expect(await logCommand(["--since", "2d", "--today", "-n", "1", "--json"], ctx)).toBe(0);
    expect(result().entries).toHaveLength(1);
    expect(result().entries[0].ts).toBe(now.toISOString());
  });

  it("preserves --today without --since", async () => {
    expect(await logCommand(["--today", "--json"], ctx)).toBe(0);
    expect(result().entries).toHaveLength(3);
  });

  it.each(["", "yesterday", "0h", "-1h", "1.5h", "1mo", "999999999999999999d"])(
    "rejects invalid duration %s",
    async (duration) => {
      expect(await logCommand(["--since=" + duration, "--json"], ctx)).toBe(2);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("--since"));
      expect(console.log).not.toHaveBeenCalled();
    },
  );
});
