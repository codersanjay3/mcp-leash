// Entry point bundled to dist/hook.mjs (copied to ~/.mcp-leash/hook.mjs by `lock`).
//
// The main thread is a thin supervisor; rules are evaluated in a worker thread so a
// catastrophic regex (ReDoS) cannot freeze the hook: after WATCHDOG_MS the worker is
// terminated and we fail open (or deny when rules.json sets failClosed).
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { type HookResult, runHook, timeoutResult } from "./hook-core.js";
import { readStdin } from "./stdin.js";

const WATCHDOG_MS = 800;

function emit(r: HookResult): Promise<void> {
  return new Promise((res) => {
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.stdout) process.stdout.write(`${r.stdout}\n`, () => res());
    else res();
  });
}

async function supervise(): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const leashHome = process.env.MCP_LEASH_HOME || join(home, ".mcp-leash");
  const stdin = await readStdin();

  const result = await new Promise<HookResult>((resolve) => {
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      resolve(timeoutResult({ stdin, leashHome }));
      void worker?.terminate();
    }, WATCHDOG_MS);
    const done = (r: HookResult) => {
      clearTimeout(timer);
      resolve(r);
    };
    try {
      worker = new Worker(fileURLToPath(import.meta.url), { workerData: { stdin, leashHome } });
    } catch {
      // Workers unavailable: evaluate inline (still fail-open on errors).
      done(runHook({ stdin, leashHome }));
      return;
    }
    worker.once("message", (r: HookResult) => done(r));
    worker.once("error", (e) =>
      done({ stdout: "", stderr: `mcp-leash: hook error: ${e.message}\n`, code: 0 }),
    );
    worker.once("exit", () =>
      done({ stdout: "", stderr: "mcp-leash: hook worker exited early\n", code: 0 }),
    );
  });

  await emit(result);
  process.exit(result.code);
}

if (isMainThread) {
  await supervise();
} else {
  parentPort?.postMessage(runHook(workerData as { stdin: string; leashHome: string }));
}
