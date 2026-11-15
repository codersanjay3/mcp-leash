import type { ArgRule, Risk } from "../types.js";

export type RuleTemplate = Omit<ArgRule, "tool"> & { tool: string };

export interface Preset {
  id: string;
  label: string;
  /** Server keys (matched on word boundaries, case-insensitive). */
  keys: string[];
  /** Substrings looked for in `command args... url` (lowercase). */
  hints: string[];
  /** Tool names or globs (`*`). Entries without `*` are used for offline scans. */
  critical?: string[];
  write?: string[];
  read?: string[];
  /** `{server}` in `tool` is replaced with the actual server name. */
  rules?: RuleTemplate[];
}

export type PresetRisk = Extract<Risk, "critical" | "write" | "read">;
