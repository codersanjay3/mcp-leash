import pkg from "../package.json" with { type: "json" };
import { lockCommand } from "./cmd-lock.js";
import { logCommand } from "./cmd-log.js";
import { scanCommand } from "./cmd-scan.js";
import { unlockCommand } from "./cmd-unlock.js";
import { runHook } from "./hook-core.js";
import { makeCtx } from "./paths.js";
import { readStdin } from "./stdin.js";

const HELP = `mcp-leash ${pkg.version}
Find the dangerous tools in your MCP servers and lock them down in Claude Code.

Usage: mcp-leash <command> [options]

Commands:
  scan     List MCP servers and classify every tool (critical / write / read / unknown)
  lock     Add deny/ask permission rules and install the argument-filtering hook
  unlock   Remove exactly what lock added
  log      Show the audit log written by the hook
  hook     (internal) PreToolUse hook entry point; reads JSON on stdin

Common options:
  --project <dir>         Project to inspect (default: current directory)
  -h, --help              Show help
  -v, --version           Show version

scan:    [--offline] [--json] [--trust-project]
lock:    [--scope user|project|local] [--level strict|balanced] [--offline] [--yes] [--no-hook]
         [--trust-project]

Project .mcp.json servers run repo-supplied commands, so scan/lock only start them with
--trust-project (or after you confirm in an interactive terminal).
unlock:  [--scope user|project|local] [--yes]
log:     [--since <duration>] [--today] [--server <name>] [--json] [-n 50]

Run without arguments to scan, e.g.:  npx mcp-leash
`;

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const ctx = makeCtx();
  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(HELP);
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(pkg.version);
    return 0;
  }
  switch (cmd) {
    case undefined:
      return scanCommand([], ctx);
    case "scan":
      return scanCommand(rest, ctx);
    case "lock":
      return lockCommand(rest, ctx);
    case "unlock":
      return unlockCommand(rest, ctx);
    case "log":
      return logCommand(rest, ctx);
    case "hook": {
      const r = runHook({ stdin: await readStdin(), leashHome: ctx.leashHome });
      if (r.stderr) process.stderr.write(r.stderr);
      if (r.stdout) process.stdout.write(`${r.stdout}\n`);
      return r.code;
    }
    default:
      if (cmd.startsWith("-")) return scanCommand([cmd, ...rest], ctx);
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

// process.exit() right after writing drops queued output when stdout is an async pipe
// (macOS), truncating `scan --json`. Flush both streams first, then exit.
function exitAfterFlush(code: number): void {
  process.exitCode = code;
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

main().then(exitAfterFlush, (e) => {
  console.error(`mcp-leash: ${e instanceof Error ? e.message : String(e)}`);
  exitAfterFlush(1);
});
