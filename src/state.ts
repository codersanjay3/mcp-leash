import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type LockRecord, writeJsonAtomic } from "./settings.js";

export interface State {
  version: 1;
  files: Record<string, LockRecord>;
}

export const statePath = (leashHome: string) => join(leashHome, "state.json");

export function readState(leashHome: string): State {
  const p = statePath(leashHome);
  if (!existsSync(p)) return { version: 1, files: {} };
  try {
    const v = JSON.parse(readFileSync(p, "utf8"));
    if (v && typeof v === "object" && v.files && typeof v.files === "object") {
      return { version: 1, files: v.files };
    }
  } catch {
    /* fall through */
  }
  throw new Error(`${p} is corrupt; fix or delete it (unlock needs it to know what was added)`);
}

export function writeState(leashHome: string, state: State): void {
  writeJsonAtomic(statePath(leashHome), state);
}
