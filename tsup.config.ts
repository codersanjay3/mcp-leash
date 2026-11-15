import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    // Standalone: must not import any package at runtime (fast cold start).
    entry: { hook: "src/hook.ts" },
    format: ["esm"],
    target: "node20",
    platform: "node",
    outExtension: () => ({ js: ".mjs" }),
    noExternal: [/.*/],
    minify: false,
  },
]);
