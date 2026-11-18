import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeServerName } from "./names.js";
import type { DiscoveredServer, Scope, ServerConfig } from "./types.js";

export function transportOf(config: ServerConfig): "stdio" | "http" | "sse" | "ws" {
  if (config.type === "sse" || config.type === "ws" || config.type === "http") return config.type;
  if (config.type === "stdio") return "stdio";
  if (config.command) return "stdio";
  return config.url ? "http" : "stdio";
}

export { normalizeServerName };

export interface DiscoverOpts {
  home: string;
  project: string;
  /** Names of enabled plugins (e.g. ["my-plugin", "other-plugin"]). */
  enabledPlugins?: string[];
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

/** Read a plugin manifest from <home>/.claude/plugins/<plugin>/manifest.json. */
function readPluginManifest(
  home: string,
  plugin: string,
  warnings: string[],
): { servers?: Record<string, ServerConfig> } | undefined {
  const manifestPath = join(home, ".claude", "plugins", plugin, "manifest.json");
  const manifest = readJson(manifestPath, warnings);
  if (!manifest) return undefined;
  const servers = manifest.servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    warnings.push(`${manifestPath}: missing or invalid "servers" object`);
    return undefined;
  }
  return { servers: servers as Record<string, ServerConfig> };
}

/**
 * Find MCP servers from user (~/.claude.json), local
 * (~/.claude.json projects[path]), project (.mcp.json), and plugin scopes.
 * Same-name precedence matches Claude Code: local > project > user > plugin.
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

  // Discover plugin servers
  const plugin: DiscoveredServer[] = [];
  for (const pluginName of opts.enabledPlugins ?? []) {
    const manifest = readPluginManifest(opts.home, pluginName, warnings);
    if (!manifest?.servers) continue;
    for (const [serverName, config] of Object.entries(manifest.servers)) {
      // Server name format: plugin_<plugin>_<server>
      const fullName = `plugin_${pluginName}_${serverName}`;
      plugin.push({
        name: fullName,
        scope: "plugin",
        config,
        file: join(opts.home, ".claude", "plugins", pluginName, "manifest.json"),
      });
    }
  }

  const byName = new Map<string, DiscoveredServer>();
  for (const s of [...user, ...proj, ...local, ...plugin]) byName.set(s.name, s);
  return { servers: [...byName.values()], warnings };
}
