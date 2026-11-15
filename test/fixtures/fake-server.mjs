// Tiny fake stdio MCP server used by the tests and the README example.
// Exposes: read_thing, delete_thing (destructiveHint), send_message.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "fake", version: "0.0.0" }, { capabilities: { tools: {} } });

const tools = [
  {
    name: "read_thing",
    description: "Read a thing by id",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "delete_thing",
    description: "Delete a thing",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    annotations: { destructiveHint: true },
  },
  {
    name: "send_message",
    description: "Send a message to a channel",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: `called ${req.params.name}` }],
}));

await server.connect(new StdioServerTransport());
