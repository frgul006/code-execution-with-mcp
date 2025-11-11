import type { Tool, ToolRunResponse } from "../tools";

type KnowledgeBaseEntry = {
  id: string;
  title: string;
  summary: string;
  url: string;
  tags: string[];
};

type KnowledgeBaseInput = {
  query: string;
  tags?: string[];
  topK?: number;
};

const KNOWLEDGE_BASE: KnowledgeBaseEntry[] = [
  {
    id: "kb-001",
    title: "Isolated JavaScript execution",
    summary:
      "Overview of how the sandbox wraps user code in an async IIFE, captures console output, and enforces a 1s timeout.",
    url: "https://example.com/docs/isolated-js",
    tags: ["sandbox", "javascript", "vm"],
  },
  {
    id: "kb-002",
    title: "Designing tool traces",
    summary:
      "Explains the recommended trace format so clients can narrate each phase of a tool invocation back to the user.",
    url: "https://example.com/docs/tracing",
    tags: ["observability", "trace"],
  },
  {
    id: "kb-003",
    title: "Model Context Protocol primer",
    summary:
      "Quick-start guide describing how hosts announce tools, negotiate sessions, and stream intermediate results.",
    url: "https://example.com/docs/mcp-primer",
    tags: ["mcp", "protocol"],
  },
  {
    id: "kb-004",
    title: "Planning dry-runs",
    summary:
      "Tactics for issuing dry-run requests so the model can inspect schemas before executing potentially unsafe actions.",
    url: "https://example.com/docs/dry-runs",
    tags: ["planning", "safety"],
  },
];

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function matches(entry: KnowledgeBaseEntry, input: KnowledgeBaseInput): boolean {
  const query = normalizeQuery(input.query);
  const inTitle = entry.title.toLowerCase().includes(query);
  const inSummary = entry.summary.toLowerCase().includes(query);
  const tagMatches = entry.tags.some((tag) => tag.toLowerCase().includes(query));

  if (input.tags && input.tags.length > 0) {
    const requestedTags = new Set(input.tags.map((tag) => tag.toLowerCase()));
    const hasRequiredTag = entry.tags.some((tag) => requestedTags.has(tag.toLowerCase()));
    if (!hasRequiredTag) {
      return false;
    }
  }

  return inTitle || inSummary || tagMatches;
}

export const knowledgeBaseTool: Tool = {
  name: "kb_lookup",
  description:
    "Search a faux product knowledge base for context around the sandbox and Model Context Protocol patterns.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        description: "Search phrase used to match the title, summary, or tags.",
        type: "string",
      },
      tags: {
        description: "Optional list of tags to filter results (any match).",
        type: "array",
      },
      topK: {
        description: "Maximum number of articles to return (defaults to 3).",
        type: "number",
      },
    },
    required: ["query"],
  },
  examples: [
    JSON.stringify(
      {
        query: "dry-run",
        tags: ["planning"],
        topK: 2,
      },
      null,
      2,
    ),
  ],
  categories: ["reference", "planning"],
};

export function runKnowledgeBaseLookup(
  payload: Record<string, unknown>,
): ToolRunResponse {
  const trace = [
    {
      title: "Validate payload",
      detail: "Ensured the knowledge base lookup request contained a search query.",
    },
  ];

  const query = payload.query;
  if (typeof query !== "string" || !query.trim()) {
    return {
      ok: false,
      message: "Expected `query` to be a non-empty string.",
      trace,
    };
  }

  let tags: string[] | undefined;
  if (Array.isArray(payload.tags)) {
    const invalidTag = payload.tags.some((tag) => typeof tag !== "string");
    if (invalidTag) {
      return {
        ok: false,
        message: "All `tags` entries must be strings.",
        trace,
      };
    }
    tags = payload.tags as string[];
  } else if (payload.tags !== undefined) {
    return {
      ok: false,
      message: "`tags` must be an array of strings when provided.",
      trace,
    };
  }

  let topK = 3;
  if (payload.topK !== undefined) {
    if (typeof payload.topK !== "number" || !Number.isFinite(payload.topK)) {
      return {
        ok: false,
        message: "`topK` must be a finite number when provided.",
        trace,
      };
    }
    topK = Math.max(1, Math.min(5, Math.floor(payload.topK)));
  }

  trace.push({
    title: "Rank entries",
    detail:
      "Performed a naive keyword match across titles, summaries, and tags, then applied optional tag filters.",
  });

  const scopedInput: KnowledgeBaseInput = { query, tags, topK };
  const matchesForQuery = KNOWLEDGE_BASE.filter((entry) => matches(entry, scopedInput)).slice(
    0,
    topK,
  );

  trace.push({
    title: "Prepare response",
    detail: `Returning ${matchesForQuery.length} curated article summaries for downstream reasoning.`,
  });

  return {
    ok: true,
    result: matchesForQuery,
    logs: [],
    trace,
  };
}
