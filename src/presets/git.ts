import type { Preset } from "./types.js";

export const git: Preset = {
  id: "git",
  label: "Git",
  keys: ["git", "mcp-server-git", "server-git"],
  hints: ["mcp-server-git", "@modelcontextprotocol/server-git", "server-git"],
  critical: ["git_reset"],
  write: ["git_commit", "git_add", "git_checkout", "git_create_branch"],
  read: ["git_status", "git_diff*", "git_log", "git_show"],
};
