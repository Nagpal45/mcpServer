import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({
    name: "mcpServer",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});
server.tool("add-numbers", "Add two numbers", {
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
}, ({ a, b }) => {
    return {
        content: [{ type: "text", text: `The sum of ${a} and ${b} is ${a + b}.` }],
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error("Error starting MCP server:", err);
    process.exit(1);
});
