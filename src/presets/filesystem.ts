import type { Preset } from "./types.js";

export const filesystem: Preset = {
  id: "filesystem",
  label: "Filesystem",
  keys: ["filesystem", "fs"],
  hints: ["server-filesystem", "mcp-server-filesystem", "filesystem-mcp"],
  critical: ["delete_file", "delete_directory", "remove_file", "remove_directory", "delete_*"],
  write: [
    "write_file",
    "edit_file",
    "move_file",
    "create_directory",
    "write_*",
    "edit_*",
    "move_*",
    "create_*",
  ],
  read: [
    "read_file",
    "read_text_file",
    "read_media_file",
    "read_multiple_files",
    "list_directory",
    "list_directory_with_sizes",
    "directory_tree",
    "search_files",
    "get_file_info",
    "list_allowed_directories",
  ],
  rules: [
    {
      tool: "mcp__{server}__write_file",
      when: { path: "!cwd" },
      decision: "ask",
      reason: "Write outside project directory",
    },
    {
      tool: "mcp__{server}__edit_file",
      when: { path: "!cwd" },
      decision: "ask",
      reason: "Edit outside project directory",
    },
    {
      tool: "mcp__{server}__create_directory",
      when: { path: "!cwd" },
      decision: "ask",
      reason: "Create directory outside project directory",
    },
    {
      tool: "mcp__{server}__move_file",
      when: { source: "!cwd" },
      decision: "ask",
      reason: "Move from outside project directory",
    },
    {
      tool: "mcp__{server}__move_file",
      when: { destination: "!cwd" },
      decision: "ask",
      reason: "Move to outside project directory",
    },
  ],
};
