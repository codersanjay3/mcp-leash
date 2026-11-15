import { resolve } from "node:path";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { printDiff } from "./cmd-lock.js";
import { approve, isScope, SCOPES } from "./common.js";
import type { Ctx } from "./paths.js";
import {
  backupFile,
  readSettingsFile,
  settingsPathFor,
  unmergeSettings,
  writeJsonAtomic,
} from "./settings.js";
import { readState, writeState } from "./state.js";
import type { Scope } from "./types.js";

export async function unlockCommand(argv: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      scope: { type: "string", default: "user" },
      project: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
    },
    strict: true,
  });
  const scope = values.scope as string;
  if (!isScope(scope)) {
    console.error(`--scope must be one of: ${SCOPES.join(", ")}`);
    return 2;
  }
  const project = resolve(values.project ?? process.cwd());
  const file = settingsPathFor(scope as Scope, ctx.home, project);
  const state = readState(ctx.leashHome);
  const record = state.files[file];
  if (!record) {
    console.log(`Nothing recorded for ${file}; nothing to unlock.`);
    return 0;
  }

  console.log(pc.bold(`Unlock → ${scope} scope\n`));
  for (const l of printDiff(file, record, "-")) console.log(l);
  console.log();

  const decision = await approve({ yes: values.yes === true, question: "Remove these entries?" });
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

  const current = readSettingsFile(file);
  const bak = backupFile(file);
  writeJsonAtomic(file, unmergeSettings(current, record));
  delete state.files[file];
  writeState(ctx.leashHome, state);

  console.log(pc.green(`✔ Updated ${file}`));
  if (bak) console.log(pc.dim(`  backup: ${bak}`));
  console.log(
    `\nRestart Claude Code for the change to take effect.\n${pc.dim(`~/.mcp-leash/hook.mjs and rules.json were left in place (${ctx.leashHome}).`)}`,
  );
  return 0;
}
