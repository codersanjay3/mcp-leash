import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { classifyTool } from "./classifier.js";
import { normalizeServerName, transportOf } from "./discovery.js";
import { matchPreset, type Preset, presetOfflineTools } from "./presets/index.js";
import { fullToolName } from "./settings.js";
import type { Classification, DiscoveredServer, Risk, ServerConfig, ToolInfo } from "./types.js";

export interface ScannedTool {
  name: string;
  fullName: string;
  risk: Risk;
  reason: string;
  source: Classification["source"];
}

export interface ScannedServer {
  name: string;
  normalizedName: string;
  scope: DiscoveredServer["scope"];
  transport: "stdio" | "http" | "sse" | "ws";
  target: string;
  preset?: string;
  source: "live" | "preset" | "none";
  error?: string;
  tools: ScannedTool[];
}

export const CONNECT_TIMEOUT_MS = 10_000;

/** Expand ${VAR} and ${VAR:-default} like Claude Code does in MCP configs. */
export function expandVars(s: string, env: NodeJS.ProcessEnv = process.env): string {
  return s.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_m, v, d) => env[v] ?? d ?? "",
  );
}

const expandAll = (r: Record<string, string> | undefined) =>
  r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, expandVars(String(v))])) : undefined;

export function describeTarget(c: ServerConfig): string {
  if (transportOf(c) === "stdio") return [c.command ?? "", ...(c.args ?? [])].join(" ").trim();
  return c.url ?? "";
}

function oneLine(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split("\n")[0]?.slice(0, 160) ?? "unknown error";
}

function failReason(e: unknown): string {
  const m = oneLine(e);
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|auth/i.test(m)) return `needs auth: ${m}`;
  if (/ENOENT/.test(m)) return `command not found: ${m}`;
  if (/Connection closed/i.test(m))
    return "server exited before answering; check its command and args";
  return m;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

async function listAll(client: Client): Promise<ToolInfo[]> {
  const tools: ToolInfo[] = [];
  let cursor: string | undefined;
  do {
    const r = await client.listTools(cursor ? { cursor } : undefined);
    for (const t of r.tools) {
      tools.push({ name: t.name, description: t.description, annotations: t.annotations });
    }
    cursor = r.nextCursor;
  } while (cursor);
  return tools;
}

async function tryConnect(transport: Transport, timeoutMs: number): Promise<ToolInfo[]> {
  const client = new Client({ name: "mcp-leash", version: "0.1.0" }, { capabilities: {} });
  try {
    await withTimeout(client.connect(transport), timeoutMs, "connect");
    return await withTimeout(listAll(client), timeoutMs, "tools/list");
  } finally {
    // close() terminates a spawned stdio child; swallow errors from dead transports.
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

export async function fetchTools(
  config: ServerConfig,
  opts: { cwd: string; timeoutMs?: number },
): Promise<ToolInfo[]> {
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT_MS;
  const kind = transportOf(config);
  if (kind === "stdio") {
    if (!config.command) throw new Error("stdio server has no command");
    const transport = new StdioClientTransport({
      command: expandVars(config.command),
      args: (config.args ?? []).map((a) => expandVars(String(a))),
      env: { ...getDefaultEnvironment(), ...expandAll(config.env) },
      stderr: "ignore",
      cwd: opts.cwd,
    });
    return tryConnect(transport, timeoutMs);
  }
  if (kind === "ws") throw new Error("ws transport is not supported yet");
  if (!config.url) throw new Error("remote server has no url");
  const url = new URL(expandVars(config.url));
  const requestInit = { headers: expandAll(config.headers) };
  if (kind === "sse") return tryConnect(new SSEClientTransport(url, { requestInit }), timeoutMs);
  try {
    return await tryConnect(new StreamableHTTPClientTransport(url, { requestInit }), timeoutMs);
  } catch (e) {
    if (/\b(401|403)\b|unauthori[sz]ed/i.test(oneLine(e))) throw e;
    try {
      return await tryConnect(new SSEClientTransport(url, { requestInit }), timeoutMs);
    } catch {
      throw e;
    }
  }
}

function classifyAll(server: DiscoveredServer, tools: ToolInfo[], preset?: Preset): ScannedTool[] {
  const normalized = normalizeServerName(server.name);
  return tools.map((t) => {
    const c = classifyTool(t, preset);
    return {
      name: t.name,
      fullName: fullToolName(normalized, t.name),
      risk: c.risk,
      reason: c.reason,
      source: c.source,
    };
  });
}

export async function scanServer(
  server: DiscoveredServer,
  opts: { offline: boolean; cwd: string; timeoutMs?: number },
): Promise<ScannedServer> {
  const preset = matchPreset(server.name, server.config);
  const base = {
    name: server.name,
    normalizedName: normalizeServerName(server.name),
    scope: server.scope,
    transport: transportOf(server.config),
    target: describeTarget(server.config),
    ...(preset ? { preset: preset.id } : {}),
  };

  if (opts.offline) {
    if (!preset) return { ...base, source: "none", tools: [] };
    const tools = presetOfflineTools(preset).map<ToolInfo>((name) => ({ name }));
    return { ...base, source: "preset", tools: classifyAll(server, tools, preset) };
  }

  try {
    const tools = await fetchTools(server.config, opts);
    return { ...base, source: "live", tools: classifyAll(server, tools, preset) };
  } catch (e) {
    return { ...base, source: "none", error: failReason(e), tools: [] };
  }
}

export async function scanAll(
  servers: DiscoveredServer[],
  opts: { offline: boolean; cwd: string; timeoutMs?: number },
): Promise<ScannedServer[]> {
  return Promise.all(servers.map((s) => scanServer(s, opts)));
}
