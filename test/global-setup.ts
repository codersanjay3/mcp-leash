import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The integration tests drive the real built binaries, so build once up front.
export default function setup() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync("npx", ["tsup", "--silent"], { cwd: root, stdio: "inherit" });
}
