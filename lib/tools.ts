import vm from "node:vm";

import { knowledgeBaseTool, runKnowledgeBaseLookup } from "./mcp/knowledgeBase";
import { runTodoManager, todoListTool } from "./mcp/todoList";

type SchemaProperty = {
  description: string;
  type: string;
};

export type ToolSchema = {
  type: "object";
  properties: Record<string, SchemaProperty>;
  required?: string[];
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  examples: string[];
  categories: string[];
};

type ExecutionTrace = {
  title: string;
  detail: string;
};

export type ToolRunSuccess = {
  ok: true;
  result: unknown;
  logs: string[];
  trace: ExecutionTrace[];
};

export type ToolRunError = {
  ok: false;
  message: string;
  trace: ExecutionTrace[];
};

export type ToolRunResponse = ToolRunSuccess | ToolRunError;

export const tools: Tool[] = [
  {
    name: "run_javascript",
    description:
      "Execute arbitrary JavaScript in a sandboxed VM. Useful for evaluating snippets produced by an LLM.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          description: "JavaScript code to evaluate. Wrap async code in an async function if desired.",
          type: "string"
        }
      },
      required: ["code"]
    },
    examples: [
      `{"code":"const output = await fetch('https://example.com');\\nreturn output.status;"}`,
      `{"code":"const numbers = [1,2,3];\\nconsole.log(numbers.map(n => n * 2));\\nreturn numbers.reduce((a,b) => a + b, 0);"}`
    ],
    categories: ["code-execution", "analysis"]
  },
  {
    name: "list_capabilities",
    description:
      "Surface the capabilities available inside the sandbox for planning or dry-run style checks.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    examples: ["{}"],
    categories: ["planning"]
  },
  {
    name: "explain_guardrails",
    description:
      "Explain the guardrails the host places around execution including timeouts and console capturing.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    examples: ["{}"],
    categories: ["safety", "observability"]
  },
  knowledgeBaseTool,
  todoListTool
];

export function getTool(toolName: string): Tool | undefined {
  return tools.find((tool) => tool.name === toolName);
}

function runJavaScript(code: string): Promise<ToolRunResponse> {
  const logs: string[] = [];
  const trace: ExecutionTrace[] = [
    {
      title: "Initialize sandbox",
      detail:
        "Created an isolated VM context with a captured console so that tool invocations remain observable."
    }
  ];

  const sandboxConsole = {
    log: (...args: unknown[]) => {
      const rendered = args
        .map((value) =>
          typeof value === "string" ? value : JSON.stringify(value, null, 2)
        )
        .join(" ");
      logs.push(rendered);
    }
  };

  const context = vm.createContext({ console: sandboxConsole });

  const wrappedSource = `
    (async () => {
      ${code}
    })()
  `;

  trace.push({
    title: "Compile script",
    detail: "Wrapped the incoming code inside an async IIFE so both sync and async snippets are supported."
  });

  const script = new vm.Script(wrappedSource, { timeout: 1000 });

  trace.push({
    title: "Execute snippet",
    detail: "Running user supplied program with a 1s timeout to match the constraints in the blog post."
  });

  try {
    const result = script.runInContext(context, { timeout: 1000 });
    return Promise.resolve(result)
      .then((value) => ({
        ok: true,
        result: value,
        logs,
        trace: [
          ...trace,
          {
            title: "Serialize result",
            detail: "Converted the resolved value plus captured console output into a structured payload."
          }
        ]
      }))
      .catch((error: unknown) => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        trace: [
          ...trace,
          {
            title: "Execution error",
            detail: "Async code rejected. Propagating the failure message to the client."
          }
        ]
      }));
  } catch (error: unknown) {
    return Promise.resolve({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      trace: [
        ...trace,
        {
          title: "Execution error",
          detail: "Synchronous failure before completion."
        }
      ]
    });
  }
}

function listCapabilities(): ToolRunResponse {
  return {
    ok: true,
    logs: [],
    result: {
      timeoutMs: 1000,
      availableGlobals: ["console"],
      supportsAsync: true,
      observability: ["console capture", "trace timeline"],
      bestPractices: [
        "Prefer deterministic, side-effect free snippets",
        "Plan with dry-run before executing untrusted code"
      ],
      tools: tools.map((tool) => ({
        name: tool.name,
        categories: tool.categories,
        description: tool.description
      }))
    },
    trace: [
      {
        title: "Describe sandbox",
        detail:
          "Returned metadata the orchestrator can use while planning tool calls, including each registered tool."
      }
    ]
  };
}

function explainGuardrails(): ToolRunResponse {
  return {
    ok: true,
    logs: [],
    result: {
      guardrails: [
        "Scripts run inside Node's vm module with no filesystem or network access",
        "Calls are time boxed to 1 second",
        "Console output is streamed back to the caller",
        "Structured traces reveal each phase of execution"
      ]
    },
    trace: [
      {
        title: "Summarize safety",
        detail: "Communicated the isolation boundaries and telemetry surfaces as highlighted in the MCP article."
      }
    ]
  };
}

export async function runTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<ToolRunResponse> {
  switch (toolName) {
    case "run_javascript": {
      const code = input.code;
      if (typeof code !== "string") {
        return {
          ok: false,
          message: "Expected `code` to be a string.",
          trace: [
            {
              title: "Validate input",
              detail: "Guard clause triggered because code was missing or not a string."
            }
          ]
        };
      }
      return runJavaScript(code);
    }
    case "list_capabilities":
      return listCapabilities();
    case "explain_guardrails":
      return explainGuardrails();
    case "kb_lookup":
      return runKnowledgeBaseLookup(input);
    case "todo_manager":
      return runTodoManager(input);
    default:
      return {
        ok: false,
        message: `Unknown tool: ${toolName}`,
        trace: [
          {
            title: "Lookup tool",
            detail: "The orchestrator asked for a tool that is not registered in this host."
          }
        ]
      };
  }
}
