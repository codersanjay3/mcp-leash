import { homedir } from "node:os";
import { join } from "node:path";

export interface Ctx {
  home: string;
  leashHome: string;
}

/** Resolve directories. Honors HOME (via os.homedir) and MCP_LEASH_HOME. */
export function makeCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
  const home = env.HOME || env.USERPROFILE || homedir();
  return { home, leashHome: env.MCP_LEASH_HOME || join(home, ".mcp-leash") };
}
