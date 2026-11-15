// Raw JSON-RPC stdio server that answers every request after LEASH_DELAY_MS.
// Used to prove the scan deadline is per server, not per step.
import { createInterface } from "node:readline";

const delay = Number(process.env.LEASH_DELAY_MS ?? 1000);
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notification
  setTimeout(() => {
    const result =
      msg.method === "initialize"
        ? {
            protocolVersion: msg.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "slow", version: "0" },
          }
        : { tools: [] };
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
  }, delay);
});
