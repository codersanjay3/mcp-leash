import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Level, Risk, Scope } from "./types.js";

export interface HookSpec {
  matcher: string;
  command: string;
}

export interface LockRecord {
  deny: string[];
  ask: string[];
  hook?: HookSpec;
}

export interface HookEntry {
  type?: string;
  command?: string;
  [k: string]: unknown;
}
export interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [k: string]: unknown;
}
export interface Settings {
  permissions?: { allow?: string[]; ask?: string[]; deny?: string[]; [k: string]: unknown };
  hooks?: { PreToolUse?: HookGroup[]; [k: string]: HookGroup[] | undefined };
  [k: string]: unknown;
}

export interface RuleSets {
  deny: string[];
  ask: string[];
  allow: string[];
}

export function settingsPathFor(scope: Scope, home: string, project: string): string {
  switch (scope) {
    case "user":
      return join(home, ".claude", "settings.json");
    case "project":
      return join(resolve(project), ".claude", "settings.json");
    case "local":
      return join(resolve(project), ".claude", "settings.local.json");
  }
}

export function fullToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/** Does permission rule `rule` cover tool `fullName` (exact, `mcp__srv__*`, or bare `mcp__srv`)? */
export function ruleCovers(rule: string, fullName: string): boolean {
  if (rule === fullName) return true;
  if (!rule.startsWith("mcp__") || rule.includes("(")) return false;
  const server = fullName.split("__")[1];
  if (server === undefined) return false;
  return rule === `mcp__${server}` || rule === `mcp__${server}__*`;
}

const anyCovers = (rules: string[], name: string) => rules.some((r) => ruleCovers(r, name));

export function toolStatus(
  fullName: string,
  rules: RuleSets,
): "denied" | "ask" | "allowed" | undefined {
  if (anyCovers(rules.deny, fullName)) return "denied";
  if (anyCovers(rules.ask, fullName)) return "ask";
  if (anyCovers(rules.allow, fullName)) return "allowed";
  return undefined;
}

export function rulesOf(settings: Settings | undefined): RuleSets {
  const p = settings?.permissions;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return { deny: arr(p?.deny), ask: arr(p?.ask), allow: arr(p?.allow) };
}

export function combineRules(list: RuleSets[]): RuleSets {
  return {
    deny: list.flatMap((r) => r.deny),
    ask: list.flatMap((r) => r.ask),
    allow: list.flatMap((r) => r.allow),
  };
}

export function planAdditions(
  tools: { fullName: string; risk: Risk }[],
  level: Level,
  existing: RuleSets,
): { deny: string[]; ask: string[] } {
  const deny: string[] = [];
  const ask: string[] = [];
  for (const t of tools) {
    const wantsDeny = t.risk === "critical";
    const wantsAsk = t.risk === "write" || (level === "strict" && t.risk === "unknown");
    if (wantsDeny) {
      if (!anyCovers(existing.deny, t.fullName) && !deny.includes(t.fullName))
        deny.push(t.fullName);
    } else if (wantsAsk) {
      if (
        !anyCovers(existing.deny, t.fullName) &&
        !anyCovers(existing.ask, t.fullName) &&
        !ask.includes(t.fullName)
      ) {
        ask.push(t.fullName);
      }
    }
  }
  return { deny, ask };
}

const hasCommand = (settings: Settings, command: string) =>
  (settings.hooks?.PreToolUse ?? []).some((g) =>
    (g.hooks ?? []).some((h) => h.command === command),
  );

/** Pure: returns a new settings object plus exactly what was added. */
export function mergeSettings(
  input: Settings,
  adds: { deny: string[]; ask: string[] },
  hook: HookSpec | undefined,
): { settings: Settings; added: LockRecord } {
  const settings = structuredClone(input) as Settings;
  const added: LockRecord = { deny: [], ask: [], hook: undefined };

  for (const key of ["deny", "ask"] as const) {
    const fresh = adds[key].filter((r) => !(settings.permissions?.[key] ?? []).includes(r));
    if (fresh.length === 0) continue;
    settings.permissions ??= {};
    settings.permissions[key] = [...(settings.permissions[key] ?? []), ...fresh];
    added[key] = fresh;
  }

  if (hook && !hasCommand(settings, hook.command)) {
    settings.hooks ??= {};
    settings.hooks.PreToolUse = [
      ...(settings.hooks.PreToolUse ?? []),
      { matcher: hook.matcher, hooks: [{ type: "command", command: hook.command }] },
    ];
    added.hook = hook;
  }
  return { settings, added };
}

/** Pure: remove exactly the recorded entries, pruning containers we emptied. */
export function unmergeSettings(input: Settings, record: LockRecord): Settings {
  const settings = structuredClone(input) as Settings;
  const perms = settings.permissions;
  if (perms) {
    for (const key of ["deny", "ask"] as const) {
      const cur = perms[key];
      if (!Array.isArray(cur)) continue;
      const next = cur.filter((r) => !record[key].includes(r));
      if (next.length === cur.length) continue;
      if (next.length) perms[key] = next;
      else delete perms[key];
    }
    if (Object.keys(perms).length === 0) delete settings.permissions;
  }

  const pre = settings.hooks?.PreToolUse;
  if (record.hook && Array.isArray(pre)) {
    const groups: HookGroup[] = [];
    for (const g of pre) {
      const hooks = g.hooks ?? [];
      const kept = hooks.filter((h) => h.command !== record.hook?.command);
      if (kept.length === hooks.length) groups.push(g);
      else if (kept.length) groups.push({ ...g, hooks: kept });
    }
    if (settings.hooks) {
      if (groups.length) settings.hooks.PreToolUse = groups;
      else delete settings.hooks.PreToolUse;
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    }
  }
  return settings;
}

export function mergeRecords(a: LockRecord, b: LockRecord): LockRecord {
  const uniq = (x: string[], y: string[]) => [...new Set([...x, ...y])];
  return { deny: uniq(a.deny, b.deny), ask: uniq(a.ask, b.ask), hook: a.hook ?? b.hook };
}

export const isEmptyRecord = (r: LockRecord) =>
  r.deny.length === 0 && r.ask.length === 0 && !r.hook;

// ---------- file helpers ----------

/** Read a JSON object file. Missing -> {}. Invalid JSON throws (we never clobber it). */
export function readSettingsFile(path: string): Settings {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} is not valid JSON (${(e as Error).message}); refusing to modify it`);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`${path} is not a JSON object; refusing to modify it`);
  }
  return v as Settings;
}

export function backupFile(path: string, now = new Date()): string | undefined {
  if (!existsSync(path)) return undefined;
  const ts = now.toISOString().replace(/[:.]/g, "-");
  let dest = `${path}.mcp-leash.bak-${ts}`;
  let n = 1;
  while (existsSync(dest)) dest = `${path}.mcp-leash.bak-${ts}-${n++}`;
  copyFileSync(path, dest);
  return dest;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.mcp-leash.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}
