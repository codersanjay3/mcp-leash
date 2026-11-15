// Entry point bundled to dist/hook.mjs (copied to ~/.mcp-leash/hook.mjs by `lock`).
import { homedir } from "node:os";
import { join } from "node:path";
import { runHook } from "./hook-core.js";
import { readStdin } from "./stdin.js";

async function main(): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const leashHome = process.env.MCP_LEASH_HOME || join(home, ".mcp-leash");
  const r = runHook({ stdin: await readStdin(), leashHome });
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.stdout) process.stdout.write(`${r.stdout}\n`);
  process.exitCode = r.code;
}

await main();
