/** Claude Code replaces characters outside [A-Za-z0-9_-] in server names with `_`. */
export function normalizeServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Claude Code normalizes both the server and the tool name to [A-Za-z0-9_-]. */
export function fullToolName(server: string, tool: string): string {
  return `mcp__${normalizeServerName(server)}__${normalizeServerName(tool)}`;
}
