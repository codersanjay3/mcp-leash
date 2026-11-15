// Pure core of the playground: no DOM, no node: imports. It calls the same classifier,
// presets and planner the CLI uses, so results match `mcp-leash scan` / `lock` exactly.
import { classifyTool } from "../src/classifier.js";
import { fullToolName, normalizeServerName } from "../src/names.js";
import { planAdditions, type RuleSets } from "../src/plan.js";
import { matchPreset, PRESETS, type Preset, presetOfflineTools } from "../src/presets/index.js";
import type { Level, Risk } from "../src/types.js";

export type Action = "deny" | "ask" | "none";

export interface InputTool {
  name: string;
  /** Present when the tool came from `scan --json`: the CLI's own classification. */
  risk?: Risk;
  reason?: string;
}

export interface InputServer {
  name: string;
  preset?: string;
  tools: InputTool[];
}

export interface ParsedInput {
  detected: "text" | "json";
  servers: InputServer[];
  error?: string;
}

export interface Row {
  server: string;
  name: string;
  fullName: string;
  risk: Risk;
  reason: string;
  action: Action;
}

export interface Analysis {
  detected: "text" | "json";
  error?: string;
  presets: string[];
  rows: Row[];
  counts: Record<Risk, number> & { total: number; deny: number; ask: number; none: number };
  plan: { deny: string[]; ask: string[] };
  /** The `permissions` snippet `lock` would add, or undefined when there is nothing to add. */
  snippet?: string;
}

const RISKS: Risk[] = ["critical", "write", "read", "unknown"];
const NO_RULES: RuleSets = { deny: [], ask: [], allow: [] };
export const DEFAULT_SERVER = "my-server";

/** One tool per line; tolerates bullets, commas-free paste, blank lines and duplicates. */
export function parseToolLines(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const name = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

function fromScanJson(v: unknown): InputServer[] | undefined {
  if (!v || typeof v !== "object" || !Array.isArray((v as { servers?: unknown }).servers)) {
    return undefined;
  }
  const out: InputServer[] = [];
  for (const s of (v as { servers: unknown[] }).servers) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    if (typeof o.name !== "string" || !Array.isArray(o.tools)) continue;
    const tools: InputTool[] = [];
    for (const t of o.tools) {
      if (!t || typeof t !== "object") continue;
      const to = t as Record<string, unknown>;
      if (typeof to.name !== "string" || to.name === "") continue;
      const risk = RISKS.find((r) => r === to.risk);
      tools.push({
        name: to.name,
        ...(risk ? { risk } : {}),
        ...(risk && typeof to.reason === "string" ? { reason: to.reason } : {}),
      });
    }
    out.push({
      name: o.name,
      ...(typeof o.preset === "string" ? { preset: o.preset } : {}),
      tools,
    });
  }
  return out;
}

/** Auto-detects `mcp-leash scan --json` output; anything else is a plain tool-name list. */
export function parseInput(serverName: string, text: string): ParsedInput {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch (e) {
      return {
        detected: "json",
        servers: [],
        error: `This looks like JSON but does not parse (${(e as Error).message}).`,
      };
    }
    const servers = fromScanJson(json);
    if (!servers) {
      return {
        detected: "json",
        servers: [],
        error: 'JSON has no "servers" array. Paste the output of `npx mcp-leash scan --json`.',
      };
    }
    return { detected: "json", servers };
  }
  const name = serverName.trim() || DEFAULT_SERVER;
  return {
    detected: "text",
    servers: [{ name, tools: parseToolLines(text).map((n) => ({ name: n })) }],
  };
}

function presetFor(server: InputServer): Preset | undefined {
  if (server.preset) {
    const byId = PRESETS.find((p) => p.id === server.preset);
    if (byId) return byId;
  }
  return matchPreset(server.name, {});
}

export function analyze(parsed: ParsedInput, level: Level): Analysis {
  const rows: Row[] = [];
  const presets: string[] = [];
  const planInput: { fullName: string; risk: Risk; server: string }[] = [];

  for (const s of parsed.servers) {
    const preset = presetFor(s);
    if (preset) presets.push(`${s.name}: ${preset.label}`);
    const server = normalizeServerName(s.name);
    for (const t of s.tools) {
      const c =
        t.risk && t.reason !== undefined
          ? { risk: t.risk, reason: t.reason }
          : classifyTool({ name: t.name }, preset);
      const fullName = fullToolName(server, t.name);
      const item = { fullName, risk: c.risk, server };
      planInput.push(item);
      const single = planAdditions([item], level, NO_RULES);
      const action: Action = single.deny.length ? "deny" : single.ask.length ? "ask" : "none";
      rows.push({ server: s.name, name: t.name, fullName, risk: c.risk, reason: c.reason, action });
    }
  }

  const counts = {
    total: rows.length,
    critical: 0,
    write: 0,
    read: 0,
    unknown: 0,
    deny: 0,
    ask: 0,
    none: 0,
  };
  for (const r of rows) {
    counts[r.risk]++;
    counts[r.action]++;
  }
  const plan = planAdditions(planInput, level, NO_RULES);
  const perms: { deny?: string[]; ask?: string[] } = {};
  if (plan.deny.length) perms.deny = plan.deny;
  if (plan.ask.length) perms.ask = plan.ask;
  const snippet =
    plan.deny.length || plan.ask.length
      ? JSON.stringify({ permissions: perms }, null, 2)
      : undefined;

  return { detected: parsed.detected, error: parsed.error, presets, rows, counts, plan, snippet };
}

/** Convenience for the UI and tests: parse, then analyze. */
export function run(serverName: string, text: string, level: Level): Analysis {
  return analyze(parseInput(serverName, text), level);
}

export interface PresetExample {
  id: string;
  label: string;
  serverName: string;
  tools: string[];
}

/** Known (non-glob) tool names from each preset, exactly what `scan --offline` uses. */
export function presetExamples(): PresetExample[] {
  return PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    serverName: p.keys[0] ?? p.id,
    tools: presetOfflineTools(p),
  }));
}
