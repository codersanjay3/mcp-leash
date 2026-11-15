// Runtime-dependency-free core of the PreToolUse hook. Only node builtins here:
// this file is bundled into dist/hook.mjs and must stay fast (no SDK, no network).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ArgRule, RulesFile } from "./types.js";

export interface PreToolUseInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [k: string]: unknown;
}

const SECRET_KEY = /token|secret|password|key|auth/i;
const SECRET_VALUE =
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;
const REDACTED = "[REDACTED]";

export function redact(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === "string") return value.replace(SECRET_VALUE, REDACTED);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth > 6) return "[Deep]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, seen, depth + 1);
  }
  return out;
}

export function argsPreview(args: unknown, max = 300): string {
  if (args === undefined) return "";
  let s: string;
  try {
    s = JSON.stringify(redact(args)) ?? "";
  } catch {
    s = "[unserializable]";
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("*")
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

export function parseToolName(name: string): { server: string; tool: string } {
  if (!name.startsWith("mcp__")) return { server: "", tool: name };
  const rest = name.slice(5);
  const i = rest.indexOf("__");
  if (i < 0) return { server: rest, tool: "" };
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function outsideCwd(p: string, cwd: string | undefined): boolean {
  const base = resolve(cwd || ".");
  const abs = isAbsolute(p) ? resolve(p) : resolve(base, p);
  const rel = relative(base, abs);
  return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel);
}

function whenMatches(
  when: Record<string, string>,
  args: Record<string, unknown>,
  cwd: string | undefined,
): boolean {
  for (const [key, pattern] of Object.entries(when)) {
    const v = args[key];
    if (v === undefined || v === null) return false;
    if (pattern === "!cwd") {
      if (typeof v !== "string" || !outsideCwd(v, cwd)) return false;
    } else if (!new RegExp(pattern).test(stringify(v))) {
      return false;
    }
  }
  return true;
}

export function evaluateRules(input: PreToolUseInput, rules: ArgRule[]): ArgRule | undefined {
  const name = input.tool_name ?? "";
  const args = (input.tool_input ?? {}) as Record<string, unknown>;
  for (const r of rules) {
    if (!globToRegExp(r.tool).test(name)) continue;
    if (r.when && !whenMatches(r.when, args, input.cwd)) continue;
    if (r.decision !== "deny" && r.decision !== "ask") continue;
    return r;
  }
  return undefined;
}

export interface HookResult {
  stdout: string;
  stderr: string;
  code: number;
}

function decisionOutput(decision: "deny" | "ask", reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: `mcp-leash: ${reason}`,
    },
  });
}

function loadRules(leashHome: string): RulesFile {
  let text: string;
  try {
    text = readFileSync(join(leashHome, "rules.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  return JSON.parse(text) as RulesFile;
}

export function runHook(opts: { stdin: string; leashHome: string; now?: Date }): HookResult {
  let failClosed = false;
  try {
    const input = JSON.parse(opts.stdin) as PreToolUseInput;
    if (!input || typeof input !== "object") throw new Error("stdin is not a JSON object");
    const rulesFile = loadRules(opts.leashHome);
    failClosed = rulesFile.failClosed === true;
    const match = evaluateRules(input, Array.isArray(rulesFile.rules) ? rulesFile.rules : []);

    const name = input.tool_name ?? "";
    const { server, tool } = parseToolName(name);
    let stderr = "";
    try {
      mkdirSync(opts.leashHome, { recursive: true });
      const line = {
        ts: (opts.now ?? new Date()).toISOString(),
        session_id: input.session_id ?? null,
        cwd: input.cwd ?? null,
        tool_name: name,
        server,
        tool,
        args_preview: argsPreview(input.tool_input),
        decision: match ? match.decision : "none",
        rule: match ? match.tool : null,
      };
      appendFileSync(join(opts.leashHome, "audit.jsonl"), `${JSON.stringify(line)}\n`);
    } catch (e) {
      stderr = `mcp-leash: could not write audit log: ${(e as Error).message}\n`;
    }
    if (!match) return { stdout: "", stderr, code: 0 };
    return {
      stdout: decisionOutput(match.decision, match.reason ?? `matched rule ${match.tool}`),
      stderr,
      code: 0,
    };
  } catch (e) {
    const msg = `mcp-leash: hook error: ${(e as Error).message}\n`;
    if (failClosed) {
      return {
        stdout: decisionOutput("deny", `internal error, failing closed (${(e as Error).message})`),
        stderr: msg,
        code: 0,
      };
    }
    return { stdout: "", stderr: msg, code: 0 };
  }
}
