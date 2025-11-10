import { NextRequest, NextResponse } from "next/server";
import { getTool, runTool } from "@/lib/tools";

type ExecuteBody = {
  toolName?: string;
  input?: Record<string, unknown>;
  mode?: "dry-run" | "execute";
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ExecuteBody;
  const toolName = body.toolName;
  const mode = body.mode ?? "execute";

  if (!toolName) {
    return NextResponse.json(
      {
        ok: false,
        message: "Missing tool name",
        trace: [
          {
            title: "Validate request",
            detail: "The MCP host requires the name of the tool to invoke."
          }
        ]
      },
      { status: 400 }
    );
  }

  const tool = getTool(toolName);

  if (!tool) {
    return NextResponse.json(
      {
        ok: false,
        message: `Unknown tool: ${toolName}`,
        trace: [
          {
            title: "Lookup tool",
            detail: "The orchestrator asked for a tool that is not registered in this host."
          }
        ]
      },
      { status: 404 }
    );
  }

  if (mode === "dry-run") {
    return NextResponse.json({
      ok: true,
      mode,
      tool: {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        examples: tool.examples,
        categories: tool.categories
      }
    });
  }

  const response = await runTool(toolName, body.input ?? {});

  return NextResponse.json({
    ok: response.ok,
    mode,
    toolName,
    ...response
  });
}
