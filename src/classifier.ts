import { lookupPresetTool, type Preset } from "./presets/index.js";
import type { Classification, ToolInfo } from "./types.js";

/** Split on `_`, `-`, `.`, whitespace, digits boundaries and camelCase. */
export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

const CRITICAL = new Set([
  "delete",
  "remove",
  "drop",
  "destroy",
  "purge",
  "truncate",
  "merge",
  "wipe",
  "erase",
  "terminate",
  "revoke",
  "uninstall",
  "kill",
  "prune",
  "clear",
  "reset",
  "overwrite",
]);
const WRITE = new Set([
  "create",
  "update",
  "write",
  "edit",
  "push",
  "send",
  "post",
  "publish",
  "execute",
  "run",
  "exec",
  "shell",
  "transfer",
  "insert",
  "set",
  "add",
  "upload",
  "move",
  "rename",
  "put",
  "patch",
  "apply",
  "deploy",
  "commit",
  "fork",
  "invite",
  "reply",
  "comment",
  "append",
  "install",
  "start",
  "stop",
  "click",
  "type",
  "fill",
  "navigate",
  "evaluate",
  "pay",
  "charge",
  "refund",
  "cancel",
  "close",
  "archive",
  "assign",
  "save",
  "submit",
  "approve",
  "enable",
  "disable",
  "grant",
  "mutate",
  "call",
  "invoke",
  "replace",
  "import",
  "duplicate",
  "copy",
  "connect",
  "rotate",
  "sync",
  "generate",
  "convert",
  "attach",
  "link",
  "schedule",
  "launch",
  "open",
  "reload",
]);
const READ = new Set([
  "get",
  "list",
  "search",
  "read",
  "fetch",
  "describe",
  "find",
  "show",
  "view",
  "query",
  "lookup",
  "check",
  "count",
  "inspect",
  "browse",
  "retrieve",
  "download",
  "export",
  "status",
  "info",
  "whoami",
  "ping",
  "tree",
  "stat",
  "head",
  "diff",
  "log",
  "logs",
  "screenshot",
  "snapshot",
]);

const DESC_CRITICAL =
  /\b(delet(e|es|ing)|remov(e|es|ing)|destroy(s|ing)?|drop(s|ping)?|purg(e|es|ing)|wipe(s)?|truncat(e|es)|permanently|irreversibl[ey]|cannot be undone)\b/i;
const DESC_WRITE =
  /\b(creat(e|es|ing)|updat(e|es|ing)|writ(e|es|ing)|send(s|ing)?|post(s|ing)?|publish(es)?|modif(y|ies)|edit(s|ing)?|execut(e|es|ing)|run(s|ning)?|upload(s)?|insert(s)?|transfer(s)?)\b/i;
const DESC_READ =
  /\b(read(s|ing)?|get(s|ting)?|list(s|ing)?|search(es)?|fetch(es)?|retriev(e|es)|return(s)?|describ(e|es)|show(s)?|view(s)?|look(s)? up)\b/i;

export function classifyTool(tool: ToolInfo, preset?: Preset): Classification {
  if (preset) {
    const hit = lookupPresetTool(preset, tool.name);
    if (hit) {
      return {
        risk: hit.risk,
        source: "preset",
        reason: `${preset.label} preset (${hit.pattern})`,
      };
    }
  }

  const a = tool.annotations;
  if (a?.destructiveHint === true) {
    return { risk: "critical", source: "annotation", reason: "destructiveHint:true" };
  }
  if (a?.readOnlyHint === true) {
    return { risk: "read", source: "annotation", reason: "readOnlyHint:true" };
  }

  const tokens = tokenize(tool.name);
  if (tokens.includes("force") && tokens.includes("push")) {
    return { risk: "critical", source: "verb", reason: 'verb "force push"' };
  }
  for (const t of tokens) {
    if (CRITICAL.has(t)) return { risk: "critical", source: "verb", reason: `verb "${t}"` };
    if (WRITE.has(t)) return { risk: "write", source: "verb", reason: `verb "${t}"` };
    if (READ.has(t)) return { risk: "read", source: "verb", reason: `verb "${t}"` };
  }

  const d = tool.description ?? "";
  if (d) {
    // Descriptions are weak evidence ("...without deleting anything" is common),
    // so they cap at "write" (ask) and never produce a deny on their own.
    if (DESC_CRITICAL.test(d)) {
      return {
        risk: "write",
        source: "description",
        reason: "description mentions deleting (review)",
      };
    }
    if (DESC_WRITE.test(d)) {
      return {
        risk: "write",
        source: "description",
        reason: "description mentions changing state",
      };
    }
    if (DESC_READ.test(d)) {
      return { risk: "read", source: "description", reason: "description reads like a lookup" };
    }
  }
  return { risk: "unknown", source: "none", reason: "no matching verb or hint" };
}
