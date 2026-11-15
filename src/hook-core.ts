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
const URL_CREDS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const MAX_ARG_CHARS = 2048;
const SECRET_VALUE =
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;
const REDACTED = "[REDACTED]";

export function redact(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === "string") {
    return value
      .replace(SECRET_VALUE, REDACTED)
      .replace(URL_CREDS, `$1${REDACTED}@`)
      .replace(BEARER, `$1 ${REDACTED}`);
  }
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

/**
 * Split `mcp__<server>__<tool>`. Server names may themselves contain `__`, so when the list of
 * known (normalized) servers is available the longest matching one wins.
 */
export function parseToolName(
  name: string,
  knownServers?: string[],
): { server: string; tool: string } {
  if (!name.startsWith("mcp__")) return { server: "", tool: name };
  const rest = name.slice(5);
  const known = (knownServers ?? [])
    .filter((s) => s && rest.startsWith(`${s}__`))
    .sort((a, b) => b.length - a.length)[0];
  if (known !== undefined) return { server: known, tool: rest.slice(known.length + 2) };
  const i = rest.indexOf("__");
  if (i < 0) return { server: rest, tool: "" };
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

function stringify(v: unknown): string {
  const s = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
  return s.length > MAX_ARG_CHARS ? s.slice(0, MAX_ARG_CHARS) : s;
}

const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,\d*\})/;

/** Simple ReDoS heuristic: a group that contains a quantifier and is itself quantified, e.g. (x+)+ */
export function findNestedQuantifiers(pattern: string): boolean {
  return NESTED_QUANTIFIER.test(pattern);
}

function outsideCwd(p: string, cwd: string | undefined): boolean {
  if (p.startsWith("~")) return true; // home-relative: never inside the session cwd
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

/**
 * First matching rule wins. A rule that throws (bad regex, malformed entry) is skipped and
 * described in `notes`, so one broken rule never disables the others.
 */
export function evaluateRules(
  input: PreToolUseInput,
  rules: ArgRule[],
  notes?: string[],
): ArgRule | undefined {
  const name = input.tool_name ?? "";
  const args = (input.tool_input ?? {}) as Record<string, unknown>;
  for (const r of rules) {
    try {
      if (!r || typeof r !== "object" || typeof r.tool !== "string") {
        throw new Error("rule must be an object with a string `tool`");
      }
      if (!globToRegExp(r.tool).test(name)) continue;
      if (r.when && !whenMatches(r.when, args, input.cwd)) continue;
      if (r.decision !== "deny" && r.decision !== "ask") continue;
      return r;
    } catch (e) {
      const label = r && typeof r === "object" && typeof r.tool === "string" ? r.tool : "(invalid)";
      notes?.push(`skipping rule for ${label}: ${(e as Error).message}`);
    }
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
  const v = JSON.parse(text) as RulesFile;
  if (!v || typeof v !== "object") throw new Error("rules.json is not a JSON object");
  return v;
}

/** Best-effort read of rules.json (never throws). */
export function peekRules(leashHome: string): RulesFile {
  try {
    return loadRules(leashHome);
  } catch {
    return {};
  }
}

function writeAudit(
  leashHome: string,
  input: PreToolUseInput,
  decision: string,
  rule: string | null,
  servers: string[] | undefined,
  now: Date,
): string {
  try {
    mkdirSync(leashHome, { recursive: true });
    const name = input.tool_name ?? "";
    const { server, tool } = parseToolName(name, servers);
    const line = {
      ts: now.toISOString(),
      session_id: input.session_id ?? null,
      cwd: input.cwd ?? null,
      tool_name: name,
      server,
      tool,
      args_preview: argsPreview(input.tool_input),
      decision,
      rule,
    };
    appendFileSync(join(leashHome, "audit.jsonl"), `${JSON.stringify(line)}\n`, { mode: 0o600 });
    return "";
  } catch (e) {
    return `mcp-leash: could not write audit log: ${(e as Error).message}\n`;
  }
}

/** Result for a hook run that exceeded the watchdog: fail open (or deny when failClosed). */
export function timeoutResult(opts: { stdin: string; leashHome: string; now?: Date }): HookResult {
  const failClosed = peekRules(opts.leashHome).failClosed === true;
  let stderr = "mcp-leash: hook timed out evaluating rules; ";
  stderr += failClosed ? "failing closed\n" : "failing open\n";
  try {
    const input = JSON.parse(opts.stdin) as PreToolUseInput;
    if (input && typeof input === "object") {
      const servers = peekRules(opts.leashHome).servers;
      stderr += writeAudit(
        opts.leashHome,
        input,
        "timeout",
        null,
        Array.isArray(servers) ? servers : undefined,
        opts.now ?? new Date(),
      );
    }
  } catch {
    /* unparsable input: nothing to audit */
  }
  return {
    stdout: failClosed ? decisionOutput("deny", "rule evaluation timed out, failing closed") : "",
    stderr,
    code: 0,
  };
}

export function runHook(opts: { stdin: string; leashHome: string; now?: Date }): HookResult {
  let input: PreToolUseInput;
  try {
    input = JSON.parse(opts.stdin) as PreToolUseInput;
    if (!input || typeof input !== "object") throw new Error("stdin is not a JSON object");
  } catch (e) {
    return { stdout: "", stderr: `mcp-leash: hook error: ${(e as Error).message}\n`, code: 0 };
  }

  // Rule evaluation is isolated from the audit: whatever goes wrong here, the audit line is
  // still attempted below.
  const notes: string[] = [];
  let failClosed = false;
  let servers: string[] | undefined;
  let match: ArgRule | undefined;
  try {
    const rulesFile = loadRules(opts.leashHome);
    failClosed = rulesFile.failClosed === true;
    if (Array.isArray(rulesFile.servers)) {
      servers = rulesFile.servers.filter((x): x is string => typeof x === "string");
    }
    match = evaluateRules(input, Array.isArray(rulesFile.rules) ? rulesFile.rules : [], notes);
  } catch (e) {
    notes.push(`could not use rules.json: ${(e as Error).message}`);
  }

  const closed = failClosed && notes.length > 0;
  const decision = closed ? "deny" : match ? match.decision : "none";
  const stderrNotes = notes.map((n) => `mcp-leash: ${n}\n`).join("");
  const auditErr = writeAudit(
    opts.leashHome,
    input,
    decision,
    match ? match.tool : null,
    servers,
    opts.now ?? new Date(),
  );
  const stderr = stderrNotes + auditErr;

  if (closed) {
    return {
      stdout: decisionOutput("deny", `rule error, failing closed (${notes[0]})`),
      stderr,
      code: 0,
    };
  }
  if (!match) return { stdout: "", stderr, code: 0 };
  return {
    stdout: decisionOutput(match.decision, match.reason ?? `matched rule ${match.tool}`),
    stderr,
    code: 0,
  };
}
