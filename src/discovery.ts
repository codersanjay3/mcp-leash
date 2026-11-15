import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DiscoveredServer, Scope, ServerConfig } from "./types.js";

/** Claude Code replaces characters outside [A-Za-z0-9_-] in server names with `_`. */
export function normalizeServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function transportOf(config: ServerConfig): "stdio" | "http" | "sse" | "ws" {
  if (config.type === "sse" || config.type === "ws" || config.type === "http") return config.type;
  if (config.type === "stdio") return "stdio";
  if (config.command) return "stdio";
  return config.url ? "http" : "stdio";
}

export interface DiscoverOpts {
  home: string;
  project: string;
}

function readJson(path: string, warnings: string[]): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const v = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch (e) {
    warnings.push(`${path}: invalid JSON (${(e as Error).message})`);
    return undefined;
  }
}

function pick(block: unknown, scope: Scope, file: string): DiscoveredServer[] {
  if (!block || typeof block !== "object") return [];
  const out: DiscoveredServer[] = [];
  for (const [name, cfg] of Object.entries(block as Record<string, unknown>)) {
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    out.push({ name, scope, config: cfg as ServerConfig, file });
  }
  return out;
}

function projectKeys(project: string): string[] {
  const abs = resolve(project);
  const keys = new Set([abs]);
  try {
    keys.add(realpathSync(abs));
  } catch {
    /* project dir may not exist */
  }
  return [...keys];
}

/**
 * Find MCP servers from user (~/.claude.json), local
 * (~/.claude.json projects[path]) and project (.mcp.json) scopes.
 * Same-name precedence matches Claude Code: local > project > user.
 */
export function discoverServers(opts: DiscoverOpts): {
  servers: DiscoveredServer[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const claudeJson = join(opts.home, ".claude.json");
  const cj = readJson(claudeJson, warnings);
  const mcpJson = join(resolve(opts.project), ".mcp.json");
  const pj = readJson(mcpJson, warnings);

  const user = pick(cj?.mcpServers, "user", claudeJson);
  const projects = (cj?.projects ?? {}) as Record<string, { mcpServers?: unknown }>;
  const local = projectKeys(opts.project).flatMap((k) =>
    pick(projects[k]?.mcpServers, "local", claudeJson),
  );
  const proj = pick(pj?.mcpServers, "project", mcpJson);

  const byName = new Map<string, DiscoveredServer>();
  for (const s of [...user, ...proj, ...local]) byName.set(s.name, s);
  return { servers: [...byName.values()], warnings };
}
