import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { approve, existingRules, isScope, runScan, SCOPES } from "./common.js";
import type { Ctx } from "./paths.js";
import { defaultRulesFor, matchPreset } from "./presets/index.js";
import {
  backupFile,
  type HookSpec,
  isEmptyRecord,
  type LockRecord,
  mergeRecords,
  mergeSettings,
  planAdditions,
  readSettingsFile,
  settingsPathFor,
  writeJsonAtomic,
} from "./settings.js";
import { readState, writeState } from "./state.js";
import type { ArgRule, Level, RulesFile, Scope } from "./types.js";

export function findHookSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "hook.mjs"), join(here, "..", "dist", "hook.mjs")];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error("hook.mjs not found next to the CLI; run `npm run build`");
  return found;
}

export function printDiff(file: string, rec: LockRecord, sign: "+" | "-"): string[] {
  const c = sign === "+" ? pc.green : pc.red;
  const out = [pc.bold(file)];
  if (rec.deny.length) {
    out.push(pc.dim("  permissions.deny"));
    for (const r of rec.deny) out.push(c(`  ${sign} ${r}`));
  }
  if (rec.ask.length) {
    out.push(pc.dim("  permissions.ask"));
    for (const r of rec.ask) out.push(c(`  ${sign} ${r}`));
  }
  if (rec.hook) {
    out.push(pc.dim("  hooks.PreToolUse"));
    out.push(c(`  ${sign} matcher ${rec.hook.matcher}  →  ${rec.hook.command}`));
  }
  return out;
}

export async function lockCommand(argv: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      scope: { type: "string", default: "user" },
      level: { type: "string", default: "balanced" },
      project: { type: "string" },
      offline: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      "no-hook": { type: "boolean", default: false },
    },
    strict: true,
  });
  const scope = values.scope as string;
  if (!isScope(scope)) {
    console.error(`--scope must be one of: ${SCOPES.join(", ")}`);
    return 2;
  }
  const level = values.level as string;
  if (level !== "strict" && level !== "balanced") {
    console.error("--level must be strict or balanced");
    return 2;
  }
  const project = resolve(values.project ?? process.cwd());
  const useHook = values["no-hook"] !== true;

  const scan = await runScan(ctx, { project, offline: values.offline === true });
  for (const w of scan.warnings) console.error(pc.yellow(`⚠ ${w}`));
  const failed = scan.servers.filter((s) => s.error);
  for (const s of failed) {
    console.log(
      pc.yellow(`⚠ ${s.name}: could not connect (${s.error}); its tools are not covered`),
    );
  }

  const tools = scan.servers.flatMap((s) => s.tools);
  const file = settingsPathFor(scope as Scope, ctx.home, project);
  const current = readSettingsFile(file); // throws on invalid JSON: never clobber
  const plan = planAdditions(tools, level as Level, existingRules(ctx, project));

  const hookPath = join(ctx.leashHome, "hook.mjs");
  const hook: HookSpec | undefined = useHook
    ? { matcher: "mcp__.*", command: `node "${hookPath}"` }
    : undefined;
  const { settings: next, added } = mergeSettings(current, plan, hook);

  if (isEmptyRecord(added)) {
    console.log(
      tools.length === 0
        ? "No MCP tools found to lock down."
        : "Nothing to change: your rules already cover these tools.",
    );
    if (useHook) installHookFiles(ctx, scan.discovered, hookPath);
    return 0;
  }

  console.log(pc.bold(`Lock (${level}) → ${scope} scope\n`));
  for (const l of printDiff(file, added, "+")) console.log(l);
  console.log();

  const decision = await approve({ yes: values.yes === true, question: "Write these changes?" });
  if (decision === "no-tty") {
    console.error(
      "Refusing to modify settings without confirmation: stdin is not a TTY. Re-run with --yes.",
    );
    return 1;
  }
  if (decision === "no") {
    console.log("Aborted. Nothing was changed.");
    return 1;
  }

  const bak = backupFile(file);
  writeJsonAtomic(file, next);
  if (useHook) installHookFiles(ctx, scan.discovered, hookPath);

  const state = readState(ctx.leashHome);
  const prev = state.files[file] ?? { deny: [], ask: [] };
  state.files[file] = mergeRecords(prev, added);
  writeState(ctx.leashHome, state);

  console.log(pc.green(`✔ Updated ${file}`));
  if (bak) console.log(pc.dim(`  backup: ${bak}`));
  console.log(
    "\nRestart Claude Code (or reload /permissions) for the rules to take effect.\nUndo any time with: npx mcp-leash unlock",
  );
  return 0;
}

function installHookFiles(
  ctx: Ctx,
  discovered: { name: string; config: import("./types.js").ServerConfig }[],
  hookPath: string,
): void {
  mkdirSync(ctx.leashHome, { recursive: true });
  const src = findHookSource();
  if (!existsSync(hookPath) || readFileSync(src, "utf8") !== readFileSync(hookPath, "utf8")) {
    copyFileSync(src, hookPath);
  }
  const rulesPath = join(ctx.leashHome, "rules.json");
  if (existsSync(rulesPath)) return; // never overwrite user edits
  const rules: ArgRule[] = [];
  for (const s of discovered) {
    const preset = matchPreset(s.name, s.config);
    if (preset) rules.push(...defaultRulesFor(preset, s.name));
  }
  const file: RulesFile = { version: 1, failClosed: false, rules };
  writeFileSync(rulesPath, `${JSON.stringify(file, null, 2)}\n`);
}
