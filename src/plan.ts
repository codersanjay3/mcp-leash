import type { Level, Risk } from "./types.js";

export interface RuleSets {
  deny: string[];
  ask: string[];
  allow: string[];
}

/**
 * Does permission rule `rule` cover tool `fullName` (exact, `mcp__srv__*`, or bare `mcp__srv`)?
 * Pass the known (normalized) `server` when available: server names may contain `__`.
 */
export function ruleCovers(rule: string, fullName: string, server?: string): boolean {
  if (rule === fullName) return true;
  if (!rule.startsWith("mcp__") || rule.includes("(")) return false;
  const srv = server ?? fullName.split("__")[1];
  if (srv === undefined) return false;
  return rule === `mcp__${srv}` || rule === `mcp__${srv}__*`;
}

export const anyCovers = (rules: string[], name: string, server?: string) =>
  rules.some((r) => ruleCovers(r, name, server));

export function planAdditions(
  tools: { fullName: string; risk: Risk; server?: string }[],
  level: Level,
  existing: RuleSets,
): { deny: string[]; ask: string[] } {
  const deny: string[] = [];
  const ask: string[] = [];
  for (const t of tools) {
    const wantsDeny = t.risk === "critical";
    const wantsAsk = t.risk === "write" || (level === "strict" && t.risk === "unknown");
    if (wantsDeny) {
      if (!anyCovers(existing.deny, t.fullName, t.server) && !deny.includes(t.fullName))
        deny.push(t.fullName);
    } else if (wantsAsk) {
      if (
        !anyCovers(existing.deny, t.fullName, t.server) &&
        !anyCovers(existing.ask, t.fullName, t.server) &&
        !ask.includes(t.fullName)
      ) {
        ask.push(t.fullName);
      }
    }
  }
  return { deny, ask };
}
