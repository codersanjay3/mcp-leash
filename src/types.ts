export type Risk = "critical" | "write" | "read" | "unknown";
export type Scope = "user" | "project" | "local" | "plugin";
export type Level = "strict" | "balanced";

export interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  annotations?: Annotations;
}

export interface Classification {
  risk: Risk;
  reason: string;
  source: "preset" | "annotation" | "verb" | "description" | "none";
}

export interface ServerConfig {
  type?: "stdio" | "http" | "sse" | "ws";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface DiscoveredServer {
  name: string;
  scope: Scope;
  config: ServerConfig;
  file: string;
}

export interface ArgRule {
  tool: string;
  when?: Record<string, string>;
  decision: "deny" | "ask";
  reason?: string;
}

export interface RulesFile {
  version?: number;
  failClosed?: boolean;
  /** Optional normalized server names, used to split `mcp__<server>__<tool>` unambiguously. */
  servers?: string[];
  rules?: ArgRule[];
}
