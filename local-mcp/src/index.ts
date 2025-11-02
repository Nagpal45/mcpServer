import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const server = new McpServer({
  name: "mcpServer",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

server.tool(
  "add-numbers",
  "Add two numbers",
  {
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  },
  ({ a, b }) => {
    return {
      content: [
        { type: "text", text: `The sum of ${a} and ${b} is ${a + b}.` },
      ],
    };
  }
);

server.tool(
  "get_github_repos",
  "Get github repositories from the given username",
  {
    username: z.string().describe("GitHub username"),
  },
  async ({ username }) => {
    const res = await fetch(`https://api.github.com/users/${username}/repos`, {
      headers: {
        "User-Agent": "MCP-Server",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch repositories for user ${username}: ${res.statusText}`
      );
    }

    const repos = await res.json();
    const repoNames = repos.map(
      (repo: any, i: number) => `${i + 1}. ${repo.name}`
    );

    return {
      content: [
        {
          type: "text",
          text: `Repositories for user ${username}: \n\n${repoNames.join(
            "\n"
          )}`,
        },
      ],
    };
  }
);

server.resource(
  "apartment-rules",
  "rules://all",
  {
    description: "A resource containing all apartment rules and regulations.",
    mimeType: "text/plain",
  },
  async (uri) => {
    const uriString = uri.toString();
    const __filePath = fileURLToPath(import.meta.url);
    const __dirName = path.dirname(__filePath);

    const rules = await fs.readFile(
      path.resolve(__dirName, "apartment-rules.txt"),
      "utf-8"
    );

    return {
      contents: [
        {
          uri: uriString,
          mimeType: "text/plain",
          text: rules,
        },
      ],
    };
  }
);

server.prompt(
  "explain-sql",
  "Explain SQL Query",
  {
    sql: z.string().describe("The SQL query to be explained"),
  },
  ({ sql }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Give me a detailed explanation of the following SQL query in plain English: ${sql}. Make it very detailed and specific for beginner to understand`,
          },
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Error starting MCP server:", err);
  process.exit(1);
});
