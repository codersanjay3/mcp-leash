import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { type LockDeps, printDiff } from "./cmd-lock.js";
import { approve, isScope, SCOPES } from "./common.js";
import type { Ctx } from "./paths.js";
import {
  backupFile,
  canonicalPath,
  readSettingsFile,
  settingsPathFor,
  unmergeSettings,
  writeJsonAtomic,
} from "./settings.js";
import { readState, writeState } from "./state.js";
import type { Scope } from "./types.js";

export async function unlockCommand(
  argv: string[],
  ctx: Ctx,
  deps: LockDeps = {},
): Promise<number> {
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
  const ask = deps.approve ?? approve;
  const project = resolve(values.project ?? process.cwd());
  const file = settingsPathFor(scope as Scope, ctx.home, project);
  // State is keyed on the real path when the file exists (older records used the given path).
  const keys = [...new Set([canonicalPath(file), file])];
  const findKey = (state: ReturnType<typeof readState>) =>
    keys.find((k) => state.files[k] !== undefined);

  const state0 = readState(ctx.leashHome);
  const key0 = findKey(state0);
  const record0 = key0 === undefined ? undefined : state0.files[key0];
  if (!record0) {
    console.log(`Nothing recorded for ${file}; nothing to unlock.`);
    return 0;
  }

  /** The settings file is gone: there is nothing to edit; drop the stale record. */
  const dropStale = () => {
    const st = readState(ctx.leashHome);
    for (const k of keys) delete st.files[k];
    writeState(ctx.leashHome, st);
    console.log(`${file} does not exist; dropped its stale record. Nothing to remove.`);
    return 0;
  };
  if (!existsSync(file)) return dropStale();

  console.log(pc.bold(`Unlock → ${scope} scope\n`));
  for (const l of printDiff(file, record0, "-")) console.log(l);
  console.log();

  const decision = await ask({ yes: values.yes === true, question: "Remove these entries?" });
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

  // Re-read both the state and the settings after the prompt.
  const state = readState(ctx.leashHome);
  const key = findKey(state);
  const record = key === undefined ? undefined : state.files[key];
  if (!record) {
    console.log("Nothing recorded any more; nothing to unlock.");
    return 0;
  }
  if (!existsSync(file)) return dropStale();
  const current = readSettingsFile(file);
  const bak = backupFile(file);
  writeJsonAtomic(file, unmergeSettings(current, record));
  for (const k of keys) delete state.files[k];
  writeState(ctx.leashHome, state);

  console.log(pc.green(`✔ Updated ${file}`));
  if (bak) console.log(pc.dim(`  backup: ${bak}`));
  console.log(
    `\nRestart Claude Code for the change to take effect.\n${pc.dim(`~/.mcp-leash/hook.mjs and rules.json were left in place (${ctx.leashHome}).`)}`,
  );
  return 0;
}
