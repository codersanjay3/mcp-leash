import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { existingRules, runScan } from "./common.js";
import { renderScan, toJson } from "./format.js";
import type { Ctx } from "./paths.js";

export async function scanCommand(argv: string[], ctx: Ctx): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      offline: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });
  const project = resolve(values.project ?? process.cwd());
  const offline = values.offline === true;
  const result = await runScan(ctx, { project, offline });
  const rules = existingRules(ctx, project);
  if (values.json) console.log(JSON.stringify(toJson(result, rules), null, 2));
  else console.log(renderScan(result, rules, offline));
  return 0;
}
