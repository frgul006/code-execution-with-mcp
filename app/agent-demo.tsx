"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  AgentMessage,
  AgentSession,
  AgentStreamEvent,
  MessageContent,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock
} from "@/lib/agent";
import type { ToolRunResponse } from "@/lib/tools";

const DEFAULT_PROMPT =
  "Use kb_lookup to gather guidance about dry-run planning, summarize the findings, and then add a follow-up reminder via todo_manager. Narrate how each tool informed your workflow.";

type ToolTimelineEvent = Extract<
  AgentStreamEvent,
  { type: "tool-request" | "tool-call" | "tool-result" }
>;

type StreamEvent = AgentStreamEvent;

type TextSegment =
  | { kind: "paragraph"; text: string }
  | { kind: "code"; code: string };

function isTextBlock(block: MessageContent): block is TextBlock {
  return block.type === "text";
}

function isToolUseBlock(block: MessageContent): block is ToolUseBlock {
  return block.type === "tool_use";
}

function isToolResultBlock(block: MessageContent): block is ToolResultBlock {
  return block.type === "tool_result";
}

function getTextFromMessage(message: AgentMessage): string {
  return message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function getToolUses(message: AgentMessage): ToolUseBlock[] {
  return message.content.filter(isToolUseBlock);
}

function getToolResults(message: AgentMessage): ToolResultBlock[] {
  return message.content.filter(isToolResultBlock);
}

function formatToolResult(result: ToolRunResponse): string {
  return JSON.stringify(result, null, 2);
}

function segmentTextContent(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  if (!text.trim()) {
    return segments;
  }

  const parts = text.split(/```/);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) {
      continue;
    }

    if (index % 2 === 1) {
      let code = part;
      const newlineIndex = code.indexOf("\n");
      if (newlineIndex !== -1) {
        const possibleLanguage = code.slice(0, newlineIndex).trim();
        if (/^[\w#+-]+$/i.test(possibleLanguage)) {
          code = code.slice(newlineIndex + 1);
        }
      }

      segments.push({ kind: "code", code: code.trim() });
      continue;
    }

    part
      .split("\n\n")
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .forEach((paragraph) => {
        segments.push({ kind: "paragraph", text: paragraph });
      });
  }

  return segments;
}

export default function AgentDemo() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [timeline, setTimeline] = useState<ToolTimelineEvent[]>([]);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages, assistantDraft]);

  const resetForNewTurn = useCallback(() => {
    setAssistantDraft("");
    setError(null);
  }, []);

  const handleEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "assistant-delta": {
        setAssistantDraft((prev) => prev + event.text);
        break;
      }
      case "message": {
        setMessages((prev) => [...prev, event.message]);
        if (event.message.role === "assistant") {
          setAssistantDraft("");
        }
        break;
      }
      case "tool-request":
      case "tool-call":
      case "tool-result": {
        setTimeline((prev) => [...prev, event]);
        break;
      }
      case "session": {
        setSession(event.session);
        setMessages(event.session.messages);
        break;
      }
      case "error": {
        setError(event.message);
        setIsStreaming(false);
        break;
      }
      case "done": {
        setIsStreaming(false);
        break;
      }
      default:
        break;
    }
  }, []);

  const streamAgentResponse = useCallback(
    async (activePrompt: string) => {
      setIsStreaming(true);
      resetForNewTurn();

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prompt: activePrompt,
            session
          })
        });

        if (!response.ok || !response.body) {
          const message = !response.ok
            ? `Agent request failed with ${response.status}`
            : "The agent did not return a stream.";
          throw new Error(message);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line) {
              try {
                const payload = JSON.parse(line) as StreamEvent;
                handleEvent(payload);
              } catch (parseError) {
                console.warn("Failed to parse agent event", parseError, line);
              }
            }
            newlineIndex = buffer.indexOf("\n");
          }
        }

        if (buffer.trim()) {
          try {
            const payload = JSON.parse(buffer.trim()) as StreamEvent;
            handleEvent(payload);
          } catch (parseError) {
            console.warn("Failed to parse trailing agent event", parseError, buffer);
          }
        }
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : "Unknown agent error";
        setError(message);
        setIsStreaming(false);
      }
    },
    [handleEvent, resetForNewTurn, session]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!prompt.trim() || isStreaming) {
        return;
      }

      const nextPrompt = prompt.trim();
      streamAgentResponse(nextPrompt);
      setPrompt("");
    },
    [isStreaming, prompt, streamAgentResponse]
  );

  const renderMessage = useCallback((message: AgentMessage, index: number) => {
    const text = getTextFromMessage(message);
    const segments = segmentTextContent(text);
    const toolCalls = getToolUses(message);
    const toolResults = getToolResults(message);

    return (
      <article key={`message-${index}`} className="message-row">
        <header className="message-header">
          <span className="badge">{message.role}</span>
        </header>
        {segments.length > 0 ? (
          <div className="message-body">
            {segments.map((segment, segmentIndex) =>
              segment.kind === "code" ? (
                <pre key={`segment-${segmentIndex}`}>{segment.code}</pre>
              ) : (
                <p key={`segment-${segmentIndex}`}>{segment.text}</p>
              )
            )}
          </div>
        ) : null}
        {toolCalls.length > 0 ? (
          <div className="message-body">
            {toolCalls.map((tool, toolIndex) => (
              <div key={`tool-${toolIndex}`} className="tool-block">
                <p>
                  <strong>Tool request:</strong> {tool.name}
                </p>
                <pre>{JSON.stringify(tool.input, null, 2)}</pre>
              </div>
            ))}
          </div>
        ) : null}
        {toolResults.length > 0 ? (
          <div className="message-body">
            {toolResults.map((tool, toolIndex) => (
              <div key={`result-${toolIndex}`} className="tool-block">
                <p>
                  <strong>Tool result:</strong>
                </p>
                <pre>{tool.content}</pre>
              </div>
            ))}
          </div>
        ) : null}
      </article>
    );
  }, []);

  const streamingMessage = useMemo(() => {
    if (!assistantDraft) {
      return null;
    }

    return (
      <article className="message-row">
        <header className="message-header">
          <span className="badge">assistant</span>
          <span className="typing-indicator">Streaming…</span>
        </header>
        <div className="message-body">
          <p>{assistantDraft}</p>
        </div>
      </article>
    );
  }, [assistantDraft]);

  return (
    <section className="response-card">
      <form onSubmit={handleSubmit} className="agent-form">
        <label>
          Prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            placeholder="Ask the agent to reason through the MCP tools"
            disabled={isStreaming}
          />
        </label>
        <button type="submit" disabled={isStreaming || !prompt.trim()}>
          {isStreaming ? "Thinking…" : "Send to agent"}
        </button>
      </form>

      {error ? (
        <div className="message-error" role="alert">
          <span className="badge">error</span>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="agent-grid">
        <div className="transcript" ref={transcriptRef}>
          <h3>Chat transcript</h3>
          <p className="transcript-subtitle">
            Watch Claude stream plans, code, and responses in real time.
          </p>
          <div className="transcript-body">
            {messages.map(renderMessage)}
            {streamingMessage}
            {messages.length === 0 && !streamingMessage ? (
              <p className="placeholder">
                Submit a prompt to watch the agent plan, call tools, and stream the
                final answer.
              </p>
            ) : null}
          </div>
        </div>
        <div className="timeline">
          <h3>Tool timeline</h3>
          <p className="transcript-subtitle">
            Intermediate MCP tool calls appear here with captured traces.
          </p>
          {session ? (
            <p className="session-id">
              Active session: <code>{session.id}</code>
            </p>
          ) : null}
          {timeline.length === 0 ? (
            <p className="placeholder">No tool activity yet.</p>
          ) : (
            <ul>
              {timeline.map((event, index) => {
                if (event.type === "tool-request") {
                  return (
                    <li key={`timeline-${index}`} className="timeline-item">
                      <span className="badge">tool requested</span>
                      <p>
                        <strong>{event.name}</strong> • Waiting for planner input
                      </p>
                    </li>
                  );
                }

                if (event.type === "tool-call") {
                  return (
                    <li key={`timeline-${index}`} className="timeline-item">
                      <span className="badge">tool call</span>
                      <p>
                        <strong>{event.name}</strong>
                      </p>
                      <pre>{JSON.stringify(event.input, null, 2)}</pre>
                    </li>
                  );
                }

                return (
                  <li key={`timeline-${index}`} className="timeline-item">
                    <span className="badge">tool result</span>
                    <p>
                      <strong>{event.id}</strong> • {event.ok ? "Success" : "Failed"}
                    </p>
                    <pre>{formatToolResult(event.payload)}</pre>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
