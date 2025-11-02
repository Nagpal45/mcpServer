import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Octokit } from "octokit";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
};

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

const ALLOWED_USERNAMES = new Set<string>([
  // Add GitHub usernames of users who should have access to the image generation tool
  // For example: 'yourusername', 'coworkerusername'
]);

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Project Planner with Auth",
    version: "1.0.0",
  });

  private get kv(): KVNamespace {
    return (this.env as Env).PROJECT_PLANNER_STORE_WITH_AUTH;
  }

  private async getProjectList(): Promise<string[]> {
    const listData = await this.kv.get(`project:user-${this.props!.login}:list`);
    return listData ? JSON.parse(listData) : [];
  }

  private async getTodoList(projectId: string): Promise<string[]> {
    const listData = await this.kv.get(`project:${projectId}:user-${this.props!.login}:todos`);
    return listData ? JSON.parse(listData) : [];
  }

  private async getTodosByProject(projectId: string): Promise<Todo[]> {
    const todoIds = await this.getTodoList(projectId);
    const todos: Todo[] = [];

    for (const todoId of todoIds) {
      const todoData = await this.kv.get(`todo:${todoId}:user-${this.props!.login}`);
      if (todoData) {
        todos.push(JSON.parse(todoData));
      }
    }

    return todos;
  }

  async init() {
    if (ALLOWED_USERNAMES.has(this.props!.login)) {
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

          await this.kv.put(`project:${projectId}:user-${this.props!.login}`, JSON.stringify(newProject));

          const projectList = await this.getProjectList();
          projectList.push(projectId);
          await this.kv.put(`project:user-${this.props!.login}:list`, JSON.stringify(projectList));

          return {
            content: [{ type: "text", text: JSON.stringify(newProject, null, 2) }],
          };
        },
      );

      this.server.tool("list_projects", "Lists all existing projects.", {}, async () => {
        const projectList = await this.getProjectList();
        const projects: Project[] = [];

        for (const projectId of projectList) {
          const projectData = await this.kv.get(`project:${projectId}:user-${this.props!.login}`);
          if (projectData) {
            projects.push(JSON.parse(projectData));
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
        };
      });

      this.server.tool(
        "get_project",
        "Retrieves details of a specific project by ID.",
        {
          projectId: z.string().describe("ID of the project to retrieve"),
        },
        async ({ projectId }) => {
          const projectData = await this.kv.get(`project:${projectId}:user-${this.props!.login}`);
          if (!projectData) {
            throw new Error(`Project with ID ${projectId} does not exist.`);
          }

          const project: Project = JSON.parse(projectData);
          const todos = await this.getTodosByProject(projectId);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ project, todos }, null, 2),
              },
            ],
          };
        },
      );

      this.server.tool(
        "delete_project",
        "Deletes a project and all its associated todo items.",
        {
          projectId: z.string().describe("ID of the project to delete"),
        },
        async ({ projectId }) => {
          const projectData = await this.kv.get(`project:${projectId}:user-${this.props!.login}`);
          if (!projectData) {
            throw new Error(`Project with ID ${projectId} does not exist.`);
          }

          const todoIds = await this.getTodoList(projectId);
          for (const todoId of todoIds) {
            await this.kv.delete(`todo:${todoId}:user-${this.props!.login}`);
          }

          await this.kv.delete(`project:${projectId}:user-${this.props!.login}`);
          await this.kv.delete(`project:${projectId}:user-${this.props!.login}:todos`);

          let projectList = await this.getProjectList();
          projectList = projectList.filter((id) => id !== projectId);
          await this.kv.put(`project:user-${this.props!.login}:list`, JSON.stringify(projectList));

          return {
            content: [
              {
                type: "text",
                text: `Project with ID ${projectId} and its associated todos have been deleted.`,
              },
            ],
          };
        },
      );

      this.server.tool(
        "create_todo",
        "Adds a new todo item to a specified project.",
        {
          projectId: z.string().describe("ID of the project to which the todo will be added"),
          title: z.string().describe("Title of the todo item"),
          description: z.string().optional().describe("Description of the todo item"),
          priority: z.enum(["low", "medium", "high"]).optional().describe("Priority of the todo item"),
        },
        async ({ projectId, title, description, priority }) => {
          const projectData = await this.kv.get(`project:${projectId}:user-${this.props!.login}`);
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

          await this.kv.put(`todo:${todoId}:user-${this.props!.login}`, JSON.stringify(newTodo));

          const todoList = await this.getTodoList(projectId);
          todoList.push(todoId);
          await this.kv.put(`project:${projectId}:todos:user-${this.props!.login}`, JSON.stringify(todoList));

          return {
            content: [{ type: "text", text: JSON.stringify(newTodo, null, 2) }],
          };
        },
      );

      this.server.tool(
        "update_todo",
        "Updates the status or details of a todo item.",
        {
          todoId: z.string().describe("ID of the todo item to update"),
          title: z.string().optional().describe("Updated title of the todo item"),
          description: z.string().optional().describe("Updated description of the todo item"),
          status: z.enum(["pending", "in-progress", "completed"]).optional().describe("Updated status of the todo item"),
          priority: z.enum(["low", "medium", "high"]).optional().describe("Updated priority of the todo item"),
        },
        async ({ todoId, title, description, status, priority }) => {
          const todoData = await this.kv.get(`todo:${todoId}:user-${this.props!.login}`);
          if (!todoData) {
            throw new Error(`Todo with ID ${todoId} does not exist.`);
          }

          const todo: Todo = JSON.parse(todoData);

          if (title !== undefined) todo.title = title;
          if (description !== undefined) todo.description = description;
          if (status !== undefined) todo.status = status;
          if (priority !== undefined) todo.priority = priority;
          todo.updatedAt = new Date().toISOString();

          await this.kv.put(`todo:${todoId}:user-${this.props!.login}`, JSON.stringify(todo));

          return {
            content: [{ type: "text", text: JSON.stringify(todo, null, 2) }],
          };
        },
      );

      this.server.tool(
        "get_todo",
        "Retrieves details of a specific todo item by ID.",
        {
          todoId: z.string().describe("ID of the todo item to retrieve"),
        },
        async ({ todoId }) => {
          const todoData = await this.kv.get(`todo:${todoId}:user-${this.props!.login}`);
          if (!todoData) {
            throw new Error(`Todo with ID ${todoId} does not exist.`);
          }

          const todo: Todo = JSON.parse(todoData);

          return {
            content: [{ type: "text", text: JSON.stringify(todo, null, 2) }],
          };
        },
      );

      this.server.tool(
        "delete_todo",
        "Deletes a todo item from a project.",
        {
          todoId: z.string().describe("ID of the todo item to delete"),
        },
        async ({ todoId }) => {
          const todoData = await this.kv.get(`todo:${todoId}:user-${this.props!.login}`);
          if (!todoData) {
            throw new Error(`Todo with ID ${todoId} does not exist.`);
          }

          const todo: Todo = JSON.parse(todoData);
          await this.kv.delete(`todo:${todoId}:user-${this.props!.login}`);

          let todoList = await this.getTodoList(todo.projectId);
          todoList = todoList.filter((id) => id !== todoId);
          await this.kv.put(`project:${todo.projectId}:todos:user-${this.props!.login}`, JSON.stringify(todoList));

          return {
            content: [{ type: "text", text: `Todo with ID ${todoId} has been deleted.` }],
          };
        },
      );

      this.server.tool(
        "list_todos",
        "Lists all todo items for a specific project.",
        {
          projectId: z.string().describe("ID of the project to list todos for"),
          status: z.enum(["pending", "in-progress", "completed"]).optional().describe("Filter todos by status"),
        },
        async ({ projectId, status }) => {
          const projectData = await this.kv.get(`project:${projectId}:user-${this.props!.login}`);
          if (!projectData) {
            throw new Error(`Project with ID ${projectId} does not exist.`);
          }

          let todos = await this.getTodosByProject(projectId);
          if (status) {
            todos = todos.filter((todo) => todo.status === status);
          }

          return {
            content: [{ type: "text", text: JSON.stringify(todos, null, 2) }],
          };
        },
      );
    }
  }
}

export default new OAuthProvider({
  // NOTE - during the summer 2025, the SSE protocol was deprecated and replaced by the Streamable-HTTP protocol
  // https://developers.cloudflare.com/agents/model-context-protocol/transport/#mcp-server-with-authentication
  apiHandlers: {
    "/sse": MyMCP.serveSSE("/sse"), // deprecated SSE protocol - use /mcp instead
    "/mcp": MyMCP.serve("/mcp"), // Streamable-HTTP protocol
  },
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});
