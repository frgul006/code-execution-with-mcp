"use client";

import { useEffect, useState } from "react";
import AgentDemo from "./agent-demo";

type ToolSummary = {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { description: string; type: string }>;
    required?: string[];
  };
  examples: string[];
  categories: string[];
};

type ExecutionTrace = {
  title: string;
  detail: string;
};

type ToolRunResponse =
  | {
      ok: true;
      mode: "execute";
      toolName: string;
      result: unknown;
      logs: string[];
      trace: ExecutionTrace[];
    }
  | {
      ok: false;
      mode: "execute";
      toolName: string;
      message: string;
      trace: ExecutionTrace[];
    };

type DryRunResponse = {
  ok: true;
  mode: "dry-run";
  tool: ToolSummary;
};

const defaultInputs: Record<string, string> = {
  run_javascript: `{
  "code": "const numbers = [1, 2, 3, 4];\\nconst doubled = numbers.map((n) => n * 2);\\nconsole.log('Doubled values:', doubled);\\nreturn doubled.reduce((acc, value) => acc + value, 0);"
}`,
  list_capabilities: `{}`,
  explain_guardrails: `{}`
};

const scenarioSteps = [
  {
    title: "1. Session boot",
    detail:
      "An orchestrator connects to the MCP host and enumerates the tooling surface area."
  },
  {
    title: "2. Plan",
    detail:
      "The model performs a dry-run against the selected tool to inspect schemas before committing to execution."
  },
  {
    title: "3. Execute",
    detail:
      "Once satisfied, the model invokes code execution, streaming back logs and the structured result."
  }
];

export default function Home() {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>("run_javascript");
  const [input, setInput] = useState<string>(defaultInputs.run_javascript);
  const [response, setResponse] = useState<ToolRunResponse | DryRunResponse | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/tools")
      .then((res) => res.json())
      .then((data: { tools: ToolSummary[] }) => {
        setTools(data.tools);
      });
  }, []);

  useEffect(() => {
    setInput(defaultInputs[selectedTool] ?? "{}");
  }, [selectedTool]);

  const handleSubmit = async (mode: "execute" | "dry-run") => {
    setIsLoading(true);
    setResponse(null);

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          toolName: selectedTool,
          mode,
          input: JSON.parse(input || "{}")
        })
      });

      const data = await res.json();
      setResponse(data);
    } catch (error) {
      setResponse({
        ok: false,
        mode: "execute",
        toolName: selectedTool,
        message:
          error instanceof Error
            ? error.message
            : "Failed to call the execute endpoint",
        trace: [
          {
            title: "Client error",
            detail: "The browser failed to reach the Next.js route."
          }
        ]
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main>
      <section>
        <span className="badge">Model Context Protocol</span>
        <h1>Hands-on code execution demo</h1>
        <p>
          This mini application re-imagines the <strong>code execution host</strong> from
          Anthropic&apos;s announcement. Explore the available tools, inspect their schemas,
          perform dry-runs, and then execute sandboxed JavaScript — all without leaving the
          browser.
        </p>
        <p>
          The goal is to demonstrate how a client can safely expose capabilities to an LLM by
          streaming structured responses, traces, and console output for each invocation.
        </p>
      </section>

      <section>
        <h2>Available tools</h2>
        <div className="grid two-columns">
          {tools.map((tool) => (
            <article key={tool.name} className="response-card">
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
              <p>
                <strong>Categories:</strong> {tool.categories.join(", ")}
              </p>
              <p>
                <strong>Example payload:</strong>
              </p>
              <pre>{tool.examples[0]}</pre>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2>Interactive session</h2>
        <div className="form-row">
          <label>
            Tool name
            <select
              value={selectedTool}
              onChange={(event) => setSelectedTool(event.target.value)}
              disabled={tools.length === 0}
            >
              {tools.length === 0 ? (
                <option value="">Loading tools…</option>
              ) : (
                tools.map((tool) => (
                  <option key={tool.name} value={tool.name}>
                    {tool.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            Input payload (JSON)
            <textarea
              rows={8}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "1rem", marginTop: "1.25rem" }}>
          <button onClick={() => handleSubmit("dry-run")} disabled={isLoading}>
            Dry-run
          </button>
          <button onClick={() => handleSubmit("execute")} disabled={isLoading}>
            Execute
          </button>
        </div>

        {response && (
          <div style={{ marginTop: "2rem" }} className="response-card">
            {response.mode === "dry-run" ? (
              <div>
                <h3>Dry-run response</h3>
                <p>
                  The orchestrator inspected <code>{response.tool.name}</code> without running
                  code. This mirrors the <em>plan-first</em> approach described in the article.
                </p>
                <pre>{JSON.stringify(response.tool, null, 2)}</pre>
              </div>
            ) : response.ok ? (
              <div>
                <h3>Execution response</h3>
                <p>
                  The tool ran successfully. Logs and structured output were streamed back just
                  like an MCP-compatible host would expose to a client.
                </p>
                <p>
                  <strong>Result:</strong>
                </p>
                <pre>{JSON.stringify(response.result, null, 2)}</pre>
                {response.logs.length > 0 && (
                  <>
                    <p>
                      <strong>Console logs</strong>
                    </p>
                    <pre>{response.logs.join("\n")}</pre>
                  </>
                )}
              </div>
            ) : (
              <div>
                <h3>Execution error</h3>
                <p>{response.message}</p>
              </div>
            )}

            {"trace" in response && response.trace?.length ? (
              <>
                <p>
                  <strong>Trace</strong>
                </p>
                <ul>
                  {response.trace.map((entry, index) => (
                    <li key={`${entry.title}-${index}`}>
                      <strong>{entry.title}:</strong> {entry.detail}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        )}
      </section>

      <section>
        <span className="badge">Claude Code Agent</span>
        <h2>Agent workflow showcase</h2>
        <p>
          This live demo streams the <strong>Vercel AI SDK</strong> working in tandem with the
          Claude Code Agent. Watch how the model plans a response, requests tools from the MCP
          host, executes generated code, and stitches the results back into the transcript.
        </p>
        <p>
          Prompts are chained together using persistent session state so you can iterate like an
          engineer pair-programming with Claude. Tool calls, intermediate snippets, and final
          answers appear in real time below.
        </p>
        <AgentDemo />
      </section>

      <section>
        <h2>Session timeline</h2>
        <p>
          The workflow mirrors the example session from the blog post. Each step emphasizes how
          Model Context Protocol hosts promote safety, observability, and repeatability when an
          LLM orchestrates tool calls.
        </p>
        <ol>
          {scenarioSteps.map((step) => (
            <li key={step.title} style={{ marginBottom: "0.75rem" }}>
              <strong>{step.title}</strong>
              <br />
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>Implementation details</h2>
        <div className="grid">
          <p>
            <strong>Sandboxed VM:</strong> Node&apos;s <code>vm</code> module powers the
            server-side execution environment. Each call creates a new context with a captured
            console, mirroring the guardrails recommended in the MCP announcement.
          </p>
          <p>
            <strong>Dry-run mode:</strong> Instead of executing code, the host returns schemas and
            examples to help the planner validate inputs. This corresponds to the &ldquo;try before you
            run&rdquo; guidance from the post.
          </p>
          <p>
            <strong>Traces:</strong> Every invocation records a human-readable timeline of events,
            providing visibility into sandbox initialization, compilation, execution, and
            serialization.
          </p>
        </div>
      </section>
    </main>
  );
}
