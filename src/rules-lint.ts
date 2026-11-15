import { findNestedQuantifiers, peekRules } from "./hook-core.js";

/** Warnings about rules.json patterns that risk catastrophic backtracking. Never throws. */
export function lintRules(leashHome: string): string[] {
  const rules = peekRules(leashHome).rules;
  if (!Array.isArray(rules)) return [];
  const out: string[] = [];
  for (const r of rules) {
    if (!r || typeof r !== "object" || !r.when || typeof r.when !== "object") continue;
    for (const [arg, pattern] of Object.entries(r.when)) {
      if (typeof pattern === "string" && pattern !== "!cwd" && findNestedQuantifiers(pattern)) {
        out.push(
          `rules.json: pattern ${pattern} for ${String(r.tool)}.${arg} has nested quantifiers and may be slow (ReDoS); the hook gives up after 800ms and fails open`,
        );
      }
    }
  }
  return out;
}
