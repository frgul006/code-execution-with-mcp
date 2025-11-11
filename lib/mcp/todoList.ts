import type { Tool, ToolRunResponse } from "../tools";

type TodoItem = {
  id: string;
  title: string;
  status: "pending" | "completed";
  tags: string[];
};

type TodoAction =
  | { action: "list"; filter?: "all" | "pending" | "completed" }
  | { action: "add"; title: string; tags?: string[] }
  | { action: "complete"; id: string };

const todos: TodoItem[] = [
  {
    id: "todo-001",
    title: "Review sandbox telemetry hooks",
    status: "pending",
    tags: ["observability"],
  },
  {
    id: "todo-002",
    title: "Draft MCP onboarding guide",
    status: "pending",
    tags: ["documentation", "mcp"],
  },
  {
    id: "todo-003",
    title: "QA dry-run workflow",
    status: "completed",
    tags: ["testing"],
  },
];

function createTraceStep(title: string, detail: string) {
  return { title, detail };
}

export const todoListTool: Tool = {
  name: "todo_manager",
  description:
    "Interact with a shared todo list that mimics a lightweight planning surface for the MCP host team.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        description: "Operation to perform: list, add, or complete.",
        type: "string",
      },
      title: {
        description: "Required when action=add. Title for the new todo item.",
        type: "string",
      },
      tags: {
        description: "Optional array of tags to associate with a new todo item.",
        type: "array",
      },
      filter: {
        description: "When listing, limit results to all, pending, or completed (defaults to pending).",
        type: "string",
      },
      id: {
        description: "Identifier of the todo to complete.",
        type: "string",
      },
    },
    required: ["action"],
  },
  examples: [
    JSON.stringify(
      {
        action: "list",
        filter: "pending",
      },
      null,
      2,
    ),
    JSON.stringify(
      {
        action: "add",
        title: "Run integration tests for kb_lookup",
        tags: ["testing"],
      },
      null,
      2,
    ),
  ],
  categories: ["productivity", "planning"],
};

function listTodos(filter: "all" | "pending" | "completed" = "pending") {
  if (filter === "all") {
    return todos;
  }
  return todos.filter((todo) => todo.status === filter);
}

function addTodo(title: string, tags: string[] = []): TodoItem {
  const newTodo: TodoItem = {
    id: `todo-${(todos.length + 1).toString().padStart(3, "0")}`,
    title,
    status: "pending",
    tags,
  };

  todos.push(newTodo);
  return newTodo;
}

function completeTodo(id: string): TodoItem | null {
  const todo = todos.find((item) => item.id === id);
  if (!todo) {
    return null;
  }

  todo.status = "completed";
  return todo;
}

function parsePayload(payload: Record<string, unknown>): TodoAction | Error {
  if (typeof payload.action !== "string") {
    return new Error("Expected `action` to be a string.");
  }

  const action = payload.action;

  switch (action) {
    case "list": {
      if (payload.filter !== undefined && typeof payload.filter !== "string") {
        return new Error("`filter` must be a string if provided.");
      }
      if (
        payload.filter &&
        payload.filter !== "all" &&
        payload.filter !== "pending" &&
        payload.filter !== "completed"
      ) {
        return new Error("`filter` must be one of all, pending, or completed.");
      }

      return { action: "list", filter: (payload.filter as TodoAction["filter"]) ?? "pending" };
    }
    case "add": {
      if (typeof payload.title !== "string" || !payload.title.trim()) {
        return new Error("`title` is required when adding a todo.");
      }

      if (payload.tags !== undefined) {
        if (!Array.isArray(payload.tags) || payload.tags.some((tag) => typeof tag !== "string")) {
          return new Error("`tags` must be an array of strings when provided.");
        }
      }

      return {
        action: "add",
        title: payload.title.trim(),
        tags: payload.tags as string[] | undefined,
      };
    }
    case "complete": {
      if (typeof payload.id !== "string" || !payload.id.trim()) {
        return new Error("`id` is required when completing a todo.");
      }

      return {
        action: "complete",
        id: payload.id.trim(),
      };
    }
    default:
      return new Error("Unsupported action. Use list, add, or complete.");
  }
}

export function runTodoManager(payload: Record<string, unknown>): ToolRunResponse {
  const trace = [createTraceStep("Validate payload", "Confirmed the action type and required fields.")];

  const parsed = parsePayload(payload);
  if (parsed instanceof Error) {
    return {
      ok: false,
      message: parsed.message,
      trace,
    };
  }

  switch (parsed.action) {
    case "list": {
      trace.push(
        createTraceStep(
          "Retrieve todos",
          `Loaded ${parsed.filter ?? "pending"} tasks from the in-memory store for visibility.`,
        ),
      );
      const results = listTodos(parsed.filter);
      trace.push(
        createTraceStep(
          "Summarize payload",
          "Returned todos with ids, statuses, and tags so downstream reasoning can decide on next steps.",
        ),
      );
      return {
        ok: true,
        result: results,
        logs: [],
        trace,
      };
    }
    case "add": {
      trace.push(
        createTraceStep(
          "Create todo",
          "Appended a new pending item into the collaborative queue to track future work.",
        ),
      );
      const created = addTodo(parsed.title, parsed.tags);
      trace.push(
        createTraceStep(
          "Confirm persistence",
          `Todo ${created.id} is now available for subsequent list or completion calls.`,
        ),
      );
      return {
        ok: true,
        result: created,
        logs: [],
        trace,
      };
    }
    case "complete": {
      trace.push(
        createTraceStep(
          "Mark complete",
          `Attempted to move ${parsed.id} into the completed bucket for the shared plan.`,
        ),
      );
      const updated = completeTodo(parsed.id);
      if (!updated) {
        return {
          ok: false,
          message: `Unable to find todo with id ${parsed.id}.`,
          trace,
        };
      }
      trace.push(
        createTraceStep(
          "Confirm persistence",
          `Todo ${updated.id} is now marked as completed and ready for reporting.`,
        ),
      );
      return {
        ok: true,
        result: updated,
        logs: [],
        trace,
      };
    }
    default:
      return {
        ok: false,
        message: "Unsupported action encountered after validation.",
        trace,
      };
  }
}

