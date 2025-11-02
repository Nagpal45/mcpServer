import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface Todo {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: "pending" | "in-progress" | "completed";
  priority: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
}

export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Project Planner MCP",
    version: "1.0.0",
  });

  private get kv(): KVNamespace {
    return (this.env as Env).PROJECT_PLANNER_STORE;
  }

  private async getProjectList(): Promise<string[]> {
      const listData = await this.kv.get("project:list");
      return listData ? JSON.parse(listData) : [];
  }

  private async getTodoList(projectId: string): Promise<string[]> {
      const listData = await this.kv.get(`project:${projectId}:todos`);
      return listData ? JSON.parse(listData) : [];
  }

  async init() {
    this.server.tool(
      "Create Project",
      "Creates a new project with the given details.",
      {
        name: z.string().describe("Project Name"),
        description: z.string().describe("Project Description"),
      },
      async ({ name, description }) => {
        const projectId = crypto.randomUUID();

        const newProject: Project = {
          id: projectId,
          name,
          description,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await this.kv.put(
          `project:${projectId}`,
          JSON.stringify(newProject)
        );

        const projectList = await this.getProjectList();
        projectList.push(projectId);
        await this.kv.put("project:list", JSON.stringify(projectList));

        return {
          content: [
            { type: "text", text: JSON.stringify(newProject, null, 2) },
          ],
        };
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
