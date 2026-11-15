import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pc from "picocolors";
import type { Ctx } from "./paths.js";
import { lintRules } from "./rules-lint.js";

export interface AuditEntry {
  ts: string;
  session_id: string | null;
  cwd: string | null;
  tool_name: string;
  server: string;
  tool: string;
  args_preview: string;
  decision: "deny" | "ask" | "none" | string;
  rule: string | null;
}

export function readAudit(leashHome: string): AuditEntry[] {
  const p = join(leashHome, "audit.jsonl");
  if (!existsSync(p)) return [];
  const out: AuditEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip a torn line */
    }
  }
  return out;
}

export function summarizeAudit(entries: AuditEntry[]) {
  const s: Record<string, { calls: number; denied: number; asked: number }> = {};
  for (const e of entries) {
    const key = e.server || "(non-mcp)";
    s[key] ??= { calls: 0, denied: 0, asked: 0 };
    const x = s[key];
    x.calls++;
    if (e.decision === "deny") x.denied++;
    if (e.decision === "ask") x.asked++;
  }
  return s;
}

export async function logCommand(argv: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      today: { type: "boolean", default: false },
      server: { type: "string" },
      json: { type: "boolean", default: false },
      n: { type: "string", short: "n", default: "50" },
    },
    strict: true,
  });
  for (const w of lintRules(ctx.leashHome)) console.error(pc.yellow(`⚠ ${w}`));
  const n = Number.parseInt(values.n as string, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error("-n must be a positive integer");
    return 2;
  }
  let entries = readAudit(ctx.leashHome);
  if (values.today) {
    const today = new Date().toDateString();
    entries = entries.filter((e) => new Date(e.ts).toDateString() === today);
  }
  if (values.server) entries = entries.filter((e) => e.server === values.server);
  entries = entries.slice(-n);
  const summary = summarizeAudit(entries);

  if (values.json) {
    console.log(JSON.stringify({ entries, summary }, null, 2));
    return 0;
  }
  if (entries.length === 0) {
    console.log(
      "No audit entries yet. They appear once the hook is installed (npx mcp-leash lock).",
    );
    return 0;
  }
  const sw = Math.max(6, ...entries.map((e) => e.server.length));
  const tw = Math.max(4, ...entries.map((e) => e.tool.length));
  console.log(
    pc.bold(`${"time".padEnd(19)}  ${"server".padEnd(sw)}  ${"tool".padEnd(tw)}  decision`),
  );
  for (const e of entries) {
    const d =
      e.decision === "deny"
        ? pc.red("deny")
        : e.decision === "ask"
          ? pc.yellow("ask")
          : pc.dim("-");
    const t = e.ts.replace("T", " ").slice(0, 19);
    console.log(`${t}  ${e.server.padEnd(sw)}  ${e.tool.padEnd(tw)}  ${d}`);
  }
  console.log(pc.bold("\nCalls per server"));
  for (const [srv, x] of Object.entries(summary)) {
    console.log(`  ${srv.padEnd(sw)}  ${x.calls} calls, ${x.denied} denied, ${x.asked} asked`);
  }
  return 0;
}
