import { createInterface } from "node:readline";
import { discoverServers } from "./discovery.js";
import type { Ctx } from "./paths.js";
import { type ScannedServer, scanAll } from "./scanner.js";
import {
  combineRules,
  type RuleSets,
  readSettingsFile,
  rulesOf,
  type Settings,
  settingsPathFor,
} from "./settings.js";
import type { DiscoveredServer, Scope } from "./types.js";

export const SCOPES: Scope[] = ["user", "project", "local"];

export interface ScanResult {
  project: string;
  discovered: DiscoveredServer[];
  servers: ScannedServer[];
  warnings: string[];
}

export async function runScan(
  ctx: Ctx,
  opts: { project: string; offline: boolean },
): Promise<ScanResult> {
  const { servers: discovered, warnings } = discoverServers({
    home: ctx.home,
    project: opts.project,
  });
  const servers = await scanAll(discovered, { offline: opts.offline, cwd: opts.project });
  return { project: opts.project, discovered, servers, warnings };
}

/** Rules from every settings file that applies to this project (unreadable files are skipped). */
export function existingRules(ctx: Ctx, project: string): RuleSets {
  const list: RuleSets[] = [];
  for (const scope of SCOPES) {
    try {
      const s: Settings = readSettingsFile(settingsPathFor(scope, ctx.home, project));
      list.push(rulesOf(s));
    } catch {
      /* ignore: scan must not fail on a broken settings file */
    }
  }
  return combineRules(list);
}

export function isScope(v: string): v is Scope {
  return (SCOPES as string[]).includes(v);
}

export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`${question} [y/N] `, (a) => {
      rl.close();
      res(/^y(es)?$/i.test(a.trim()));
    });
  });
}

/**
 * Decide whether we may write. `--yes` -> yes. No TTY and no --yes -> abort.
 * Otherwise ask.
 */
export async function approve(opts: {
  yes: boolean;
  question: string;
}): Promise<"yes" | "no" | "no-tty"> {
  if (opts.yes) return "yes";
  if (!process.stdin.isTTY) return "no-tty";
  return (await confirm(opts.question)) ? "yes" : "no";
}
