import type { Preset } from "./types.js";

// mcp-server-git (modelcontextprotocol/servers, `uvx mcp-server-git`, Docker image `mcp/git`).
// Its hints are substrings of the GitHub ones (`mcp-server-git` is in `mcp-server-github`),
// so this preset must come after `github` in PRESETS.
export const git: Preset = {
  id: "git",
  label: "Git",
  keys: ["git"],
  hints: ["mcp-server-git", "server-git", "mcp/git"],
  critical: ["git_reset"],
  write: ["git_commit", "git_add", "git_checkout", "git_create_branch", "git_merge", "git_init"],
  read: [
    "git_status",
    "git_diff",
    "git_diff_staged",
    "git_diff_unstaged",
    "git_log",
    "git_show",
    "git_branch",
    "git_remote",
    "git_diff_*",
  ],
};
