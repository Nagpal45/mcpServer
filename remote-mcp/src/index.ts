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

  private async getTodosByProject(projectId: string): Promise<Todo[]> {
    const todoIds = await this.getTodoList(projectId);
    const todos: Todo[] = [];

    for (const todoId of todoIds) {
      const todoData = await this.kv.get(`todo:${todoId}`);
      if (todoData) {
        todos.push(JSON.parse(todoData));
      }
    }

    return todos;
  }

  async init() {
    this.server.tool(
      "create_project",
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

        await this.kv.put(`project:${projectId}`, JSON.stringify(newProject));

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

    this.server.tool("list_projects", "Lists all existing projects.", {}, async () => {
      const projectList = await this.getProjectList();
      const projects: Project[] = [];
      
      for (const projectId of projectList) {
        const projectData = await this.kv.get(`project:${projectId}`);
        if (projectData) {
          projects.push(JSON.parse(projectData));
        }
      }

      return {
        content: [
          { type: "text", text: JSON.stringify(projects, null, 2) },
        ],
      };
    });

    this.server.tool("get_project", "Retrieves details of a specific project by ID.", {
      projectId: z.string().describe("ID of the project to retrieve"),
    }, async ({ projectId }) => {
      const projectData = await this.kv.get(`project:${projectId}`);
      if (!projectData) {
        throw new Error(`Project with ID ${projectId} does not exist.`);
      }

      const project: Project = JSON.parse(projectData);
      const todos = await this.getTodosByProject(projectId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { project, todos },
              null,
              2
            ),
          },
        ],
      };
    });

    this.server.tool(
      "add_todo",
      "Adds a new todo item to a specified project.",
      {
        projectId: z
          .string()
          .describe("ID of the project to which the todo will be added"),
        title: z.string().describe("Title of the todo item"),
        description: z
          .string()
          .optional()
          .describe("Description of the todo item"),
        priority: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Priority of the todo item"),
      },
      async ({ projectId, title, description, priority }) => {
        const projectData = await this.kv.get(`project:${projectId}`);
        if (!projectData) {
          throw new Error(`Project with ID ${projectId} does not exist.`);
        }

        const todoId = crypto.randomUUID();

        const newTodo: Todo = {
          id: todoId,
          projectId,
          title,
          description: description || "",
          status: "pending",
          priority: priority || "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await this.kv.put(`todo:${todoId}`, JSON.stringify(newTodo));

        const todoList = await this.getTodoList(projectId);
        todoList.push(todoId);
        await this.kv.put(
          `project:${projectId}:todos`,
          JSON.stringify(todoList)
        );

        return {
          content: [{ type: "text", text: JSON.stringify(newTodo, null, 2) }],
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
