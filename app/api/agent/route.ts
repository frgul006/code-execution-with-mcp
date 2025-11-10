import { NextResponse } from "next/server";
import { createAgentResponse, type AgentRequest } from "@/lib/agent";

export const runtime = "edge";

export async function POST(request: Request) {
  let payload: AgentRequest;

  try {
    payload = (await request.json()) as AgentRequest;
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  if (!payload?.prompt || typeof payload.prompt !== "string") {
    return NextResponse.json(
      { error: "`prompt` must be a non-empty string" },
      { status: 400 }
    );
  }

  try {
    const { response } = await createAgentResponse(payload);
    return response;
  } catch (error) {
    console.error("Failed to run Claude agent", error);
    return NextResponse.json(
      { error: (error as Error).message ?? "Unknown agent error" },
      { status: 500 }
    );
  }
}
