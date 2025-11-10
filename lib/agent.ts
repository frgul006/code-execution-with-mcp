import { experimental_StreamData, StreamingTextResponse } from "ai";
import { runTool, tools, type ToolRunResponse } from "./tools";

const ANTHROPIC_API_URL =
  process.env.ANTHROPIC_API_URL ?? "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = process.env.ANTHROPIC_AGENT_MODEL ?? "claude-3-5-sonnet-20241022";
const MAX_OUTPUT_TOKENS = Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS ?? 4096);

function getAnthropicHeaders() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable.");
  }

  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  } as const;
}

export type TextBlock = {
  type: "text";
  text: string;
};

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};

export type MessageContent = TextBlock | ToolUseBlock | ToolResultBlock;

export type AgentMessage = {
  role: "user" | "assistant" | "tool";
  content: MessageContent[];
};

export type AgentSession = {
  id: string;
  messages: AgentMessage[];
};

export type AgentRequest = {
  prompt: string;
  session?: AgentSession | null;
};

type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  index: number;
};

type AnthropicEvent = {
  event: string;
  data?: unknown;
};

type StreamTurnResult = {
  assistantMessage: AgentMessage;
  toolCalls: ToolCall[];
};

const textEncoder = new TextEncoder();

function parseEvent(raw: string): AnthropicEvent | null {
  const lines = raw.split("\n");
  let event = "";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (!event && dataLines.length === 0) {
    return null;
  }

  const dataPayload = dataLines.join("");
  if (!dataPayload) {
    return { event };
  }
  if (dataPayload === "[DONE]") {
    return { event, data: "[DONE]" };
  }

  try {
    return { event, data: JSON.parse(dataPayload) };
  } catch (error) {
    console.warn("Failed to parse SSE event", error, dataPayload);
    return null;
  }
}

function renderToolResult(result: ToolRunResponse): string {
  if (result.ok) {
    return JSON.stringify(
      {
        ok: true,
        result: result.result,
        logs: result.logs,
        trace: result.trace
      },
      null,
      2
    );
  }

  return JSON.stringify(
    {
      ok: false,
      message: result.message,
      trace: result.trace
    },
    null,
    2
  );
}

type StreamData = InstanceType<typeof experimental_StreamData>;

async function streamClaudeTurn(
  messages: AgentMessage[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  data: StreamData
): Promise<StreamTurnResult> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: getAnthropicHeaders(),
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      messages,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      })),
      tool_choice: "auto",
      stream: true
    })
  });

  if (!response.body) {
    throw new Error("Claude API did not return a response body");
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const assistantMessage: AgentMessage = { role: "assistant", content: [] };
  const toolCalls: ToolCall[] = [];
  const pendingToolInputs = new Map<number, { id: string; name: string; buffer: string }>();

  const processBuffer = (): boolean => {
    let eventBoundary = buffer.indexOf("\n\n");
    while (eventBoundary !== -1) {
      const rawEvent = buffer.slice(0, eventBoundary);
      buffer = buffer.slice(eventBoundary + 2);

      const parsed = parseEvent(rawEvent);
      if (!parsed) {
        eventBoundary = buffer.indexOf("\n\n");
        continue;
      }

      if (parsed.data === "[DONE]") {
        reader.releaseLock();
        return true;
      }

      const payload = parsed.data as Record<string, unknown> | undefined;
      switch (parsed.event) {
        case "content_block_start": {
          const index = payload?.index as number | undefined;
          const content = payload?.content_block as Record<string, unknown> | undefined;
          if (typeof index !== "number" || !content) {
            break;
          }

          if (content.type === "text") {
            assistantMessage.content[index] = { type: "text", text: "" };
          } else if (content.type === "tool_use") {
            const id = String(content.id ?? crypto.randomUUID());
            const name = String(content.name ?? "");
            assistantMessage.content[index] = {
              type: "tool_use",
              id,
              name,
              input: {}
            };
            pendingToolInputs.set(index, { id, name, buffer: "" });
            data.append({
              type: "tool-request",
              id,
              name
            });
          }
          break;
        }
        case "content_block_delta": {
          const index = payload?.index as number | undefined;
          const delta = payload?.delta as Record<string, unknown> | undefined;
          if (typeof index !== "number" || !delta) {
            break;
          }

          if (delta.type === "text_delta") {
            const text = String(delta.text ?? "");
            const block = assistantMessage.content[index];
            if (block && block.type === "text") {
              block.text += text;
            }
            if (text) {
              controller.enqueue(textEncoder.encode(text));
            }
          } else if (delta.type === "input_json_delta") {
            const partial = String(delta.partial_json ?? "");
            const pending = pendingToolInputs.get(index);
            if (pending) {
              pending.buffer += partial;
            }
          }
          break;
        }
        case "content_block_stop": {
          const index = payload?.index as number | undefined;
          if (typeof index !== "number") {
            break;
          }
          const pending = pendingToolInputs.get(index);
          if (!pending) {
            break;
          }
          pendingToolInputs.delete(index);
          const inputBuffer = pending.buffer.trim();
          let input: Record<string, unknown> = {};
          if (inputBuffer) {
            try {
              input = JSON.parse(inputBuffer);
            } catch (error) {
              console.warn("Failed to parse tool input", error, inputBuffer);
            }
          }
          const block = assistantMessage.content[index];
          if (block && block.type === "tool_use") {
            block.input = input;
            toolCalls.push({ id: block.id, name: block.name, input, index });
          }
          break;
        }
        case "message_stop": {
          reader.releaseLock();
          return true;
        }
        case "error": {
          throw new Error("Claude streaming error");
        }
        default:
          break;
      }

      eventBoundary = buffer.indexOf("\n\n");
    }

    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (processBuffer()) {
        return { assistantMessage, toolCalls };
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    if (processBuffer()) {
      return { assistantMessage, toolCalls };
    }
  }

  reader.releaseLock();
  return { assistantMessage, toolCalls };
}

export async function createAgentResponse({ prompt, session }: AgentRequest) {
  const data = new experimental_StreamData();
  const sessionId = session?.id ?? crypto.randomUUID();
  const conversation: AgentMessage[] = [...(session?.messages ?? [])];

  const userMessage: AgentMessage = {
    role: "user",
    content: [{ type: "text", text: prompt }]
  };

  conversation.push(userMessage);
  data.append({ type: "message", message: userMessage });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { assistantMessage, toolCalls } = await streamClaudeTurn(
            conversation,
            controller,
            data
          );

          conversation.push(assistantMessage);
          data.append({ type: "message", message: assistantMessage });

          if (toolCalls.length === 0) {
            break;
          }

          for (const call of toolCalls) {
            data.append({
              type: "tool-call",
              id: call.id,
              name: call.name,
              input: call.input
            });

            const result = await runTool(call.name, call.input);

            data.append({
              type: "tool-result",
              id: call.id,
              ok: result.ok,
              payload: result
            });

            const toolMessage: AgentMessage = {
              role: "tool",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: call.id,
                  content: renderToolResult(result)
                }
              ]
            };

            conversation.push(toolMessage);
            data.append({ type: "message", message: toolMessage });
          }
        }

        data.append({
          type: "session",
          session: {
            id: sessionId,
            messages: conversation
          }
        });
      } catch (error) {
        controller.error(error);
      } finally {
        controller.close();
        data.close();
      }
    }
  });

  return {
    response: new StreamingTextResponse(stream, {
      data
    })
  };
}
