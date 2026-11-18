import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { approve, existingRules, isScope, LOCK_SCOPES, runScan } from "./common.js";
import { normalizeServerName } from "./discovery.js";
import type { Ctx } from "./paths.js";
import { defaultRulesFor, matchPreset } from "./presets/index.js";
import { lintRules } from "./rules-lint.js";
import {
  allowOverrides,
  backupFile,
  canonicalPath,
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
import { readState, statePath, writeState } from "./state.js";
import type { ArgRule, Level, RulesFile, Scope } from "./types.js";

export interface LockDeps {
  /** Replaceable confirmation step (tests). */
  approve?: typeof approve;
}

export function findHookSource(ctx?: Ctx): string {
  if (ctx?.hookSource) {
    if (!existsSync(ctx.hookSource)) throw new Error(`hook.mjs not found at ${ctx.hookSource}`);
    return ctx.hookSource;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "hook.mjs"), join(here, "..", "dist", "hook.mjs")];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error("hook.mjs not found next to the CLI; run `npm run build`");
  return found;
}

export function printDiff(
  file: string,
  rec: LockRecord,
  sign: "+" | "-",
  overrides: { tool: string; rule: string }[] = [],
): string[] {
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
  for (const o of overrides) {
    const via = o.rule === o.tool ? "" : ` (${o.rule})`;
    out.push(pc.yellow(`  ! ${o.tool} overrides your allow${via}`));
  }
  return out;
}

export async function lockCommand(argv: string[], ctx: Ctx, deps: LockDeps = {}): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      scope: { type: "string", default: "user" },
      level: { type: "string", default: "balanced" },
      project: { type: "string" },
      offline: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      "no-hook": { type: "boolean", default: false },
      "trust-project": { type: "boolean", default: false },
    },
    strict: true,
  });
  const ask = deps.approve ?? approve;
  const scope = values.scope as string;
  if (!LOCK_SCOPES.includes(scope as Scope)) {
    console.error(`--scope must be one of: ${LOCK_SCOPES.join(", ")}`);
    return 2;
  }
  const level = values.level as string;
  if (level !== "strict" && level !== "balanced") {
    console.error("--level must be strict or balanced");
    return 2;
  }
  const project = resolve(values.project ?? process.cwd());
  const useHook = values["no-hook"] !== true;

  // Preflight: everything that can fail for reasons unrelated to the settings file runs
  // first, so a corrupt state.json or a missing hook never leaves settings half-modified.
  readState(ctx.leashHome);
  const hookSrc = useHook ? findHookSource(ctx) : undefined;

  const scan = await runScan(ctx, {
    project,
    offline: values.offline === true,
    trustProject: values["trust-project"] === true,
  });
  for (const w of scan.warnings) console.error(pc.yellow(`⚠ ${w}`));
  for (const w of lintRules(ctx.leashHome)) console.error(pc.yellow(`⚠ ${w}`));
  for (const s of scan.servers.filter((x) => x.note)) {
    console.log(
      pc.yellow(
        `⚠ ${s.name}: ${s.note}; classified from presets only, so tools without a preset are not covered`,
      ),
    );
  }
  for (const s of scan.servers.filter((x) => x.error)) {
    console.log(
      pc.yellow(`⚠ ${s.name}: could not connect (${s.error}); its tools are not covered`),
    );
  }
  if (useHook && scope === "project") {
    console.error(
      pc.yellow(
        "⚠ --scope project writes an absolute, machine-specific hook path into a file you may commit; teammates need their own `mcp-leash lock`. Prefer --scope local or user.",
      ),
    );
  }

  const tools = scan.servers.flatMap((s) => s.tools);
  const file = settingsPathFor(scope as Scope, ctx.home, project);
  const hookPath = join(ctx.leashHome, "hook.mjs");
  const hook: HookSpec | undefined = useHook
    ? { matcher: "mcp__.*", command: `node "${hookPath}"` }
    : undefined;

  /** Plan against the settings as they are right now (read fresh each time). */
  const compute = () => {
    const current = readSettingsFile(file); // throws on invalid JSON: never clobber
    const existing = existingRules(ctx, project);
    const plan = planAdditions(tools, level as Level, existing);
    const { settings: next, added } = mergeSettings(current, plan, hook);
    return { next, added, overrides: allowOverrides(added, existing) };
  };

  const first = compute();
  if (isEmptyRecord(first.added)) {
    console.log(
      tools.length === 0
        ? "No MCP tools found to lock down."
        : "Nothing to change: your rules already cover these tools.",
    );
    if (hookSrc) installHookFiles(ctx, scan.discovered, hookPath, hookSrc);
    return 0;
  }

  console.log(pc.bold(`Lock (${level}) → ${scope} scope\n`));
  for (const l of printDiff(file, first.added, "+", first.overrides)) console.log(l);
  console.log();

  const decision = await ask({ yes: values.yes === true, question: "Write these changes?" });
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

  // The file may have changed while the prompt was open: merge again on the fresh content.
  const fresh = compute();
  if (isEmptyRecord(fresh.added)) {
    console.log("Nothing to change: your rules already cover these tools.");
    return 0;
  }
  if (JSON.stringify(fresh.added) !== JSON.stringify(first.added)) {
    console.log(pc.yellow("Settings changed while waiting; applying to the current content:"));
    for (const l of printDiff(file, fresh.added, "+", fresh.overrides)) console.log(l);
  }

  if (hookSrc) installHookFiles(ctx, scan.discovered, hookPath, hookSrc);

  // State first, then settings; if the settings write fails, put the state back.
  const stateExisted = existsSync(statePath(ctx.leashHome));
  const prevState = readState(ctx.leashHome);
  const state = structuredClone(prevState);
  const key = canonicalPath(file);
  state.files[key] = mergeRecords(state.files[key] ?? { deny: [], ask: [] }, fresh.added);
  writeState(ctx.leashHome, state);
  let bak: string | undefined;
  try {
    bak = backupFile(file);
    writeJsonAtomic(file, fresh.next);
  } catch (e) {
    if (stateExisted) writeState(ctx.leashHome, prevState);
    else rmSync(statePath(ctx.leashHome), { force: true });
    throw e;
  }

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
  src: string,
): void {
  mkdirSync(ctx.leashHome, { recursive: true });
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
  const servers = [...new Set(discovered.map((s) => normalizeServerName(s.name)))];
  const file: RulesFile = { version: 1, failClosed: false, servers, rules };
  writeFileSync(rulesPath, `${JSON.stringify(file, null, 2)}\n`);
}
