// Stub stdio MCP server used only to record the README demo GIF.
// It advertises the tool names of a real server (given as argv[2]) but does nothing.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const SETS = {
  github: ["get_issue", "list_pull_requests", "search_code", "create_issue", "add_issue_comment",
    "push_files", "create_or_update_file", "merge_pull_request", "delete_branch", "delete_repository"],
  filesystem: ["read_text_file", "list_directory", "search_files", "write_file", "edit_file", "move_file"],
};
const names = SETS[process.argv[2]] ?? [];
const tools = names.map((name) => ({ name, description: "", inputSchema: { type: "object", properties: {} } }));
const server = new Server({ name: process.argv[2] ?? "stub", version: "0.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "stub" }] }));
await server.connect(new StdioServerTransport());
