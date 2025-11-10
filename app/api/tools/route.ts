import { NextResponse } from "next/server";
import { tools } from "@/lib/tools";

export async function GET() {
  return NextResponse.json({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      examples: tool.examples,
      categories: tool.categories
    }))
  });
}
