import { type ChildProcess, spawn } from "node:child_process";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface GroupStdioParams {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function signalGroup(pid: number, sig: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, sig);
    return true;
  } catch {
    return false; // ESRCH: group is gone
  }
}

/**
 * Stdio client transport that starts the server as the leader of its own process group, so
 * cleanup can kill the whole tree (e.g. `sh -c "sleep 300"` grandchildren), not just the
 * direct child. POSIX only; the caller falls back to the SDK transport on Windows.
 */
export class GroupStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private proc?: ChildProcess;
  private pgid?: number;
  private readonly buffer = new ReadBuffer();

  constructor(private readonly params: GroupStdioParams) {}

  start(): Promise<void> {
    if (this.proc) return Promise.reject(new Error("transport already started"));
    return new Promise((resolve, reject) => {
      const p = spawn(this.params.command, this.params.args, {
        env: this.params.env,
        cwd: this.params.cwd,
        stdio: ["pipe", "pipe", "ignore"],
        shell: false,
        detached: true, // new process group; pgid === pid
      });
      this.proc = p;
      p.on("error", (e) => {
        reject(e);
        this.onerror?.(e);
      });
      p.on("spawn", () => {
        this.pgid = p.pid;
        resolve();
      });
      p.on("close", () => {
        this.proc = undefined;
        this.onclose?.();
      });
      p.stdin?.on("error", (e) => this.onerror?.(e));
      p.stdout?.on("error", (e) => this.onerror?.(e));
      p.stdout?.on("data", (chunk: Buffer) => {
        try {
          this.buffer.append(chunk);
          for (;;) {
            const m = this.buffer.readMessage();
            if (m === null) break;
            this.onmessage?.(m);
          }
        } catch (e) {
          this.onerror?.(e as Error);
        }
      });
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdin = this.proc?.stdin;
      if (!stdin) return reject(new Error("Not connected"));
      if (stdin.write(serializeMessage(message))) resolve();
      else stdin.once("drain", () => resolve());
    });
  }

  async close(): Promise<void> {
    const p = this.proc;
    const pgid = this.pgid;
    this.proc = undefined;
    this.buffer.clear();
    if (!p || pgid === undefined) return;
    try {
      p.stdin?.end();
    } catch {
      /* ignore */
    }
    // Give a well-behaved server a moment to exit on stdin EOF, then take the whole group down.
    const exited = new Promise<void>((r) => p.once("exit", () => r()));
    await Promise.race([exited, sleep(300)]);
    if (signalGroup(pgid, "SIGTERM")) {
      for (let i = 0; i < 20 && signalGroup(pgid, 0); i++) await sleep(25);
      signalGroup(pgid, "SIGKILL");
    }
    p.stdout?.destroy();
  }
}
