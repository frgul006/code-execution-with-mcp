# Code Execution with MCP demo

This repository contains a small Next.js + TypeScript application that demonstrates the
concepts from Anthropic's [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
announcement.

## Features

- **Tool registry** – The API exposes a list of MCP-style tools including a sandboxed
  `run_javascript` executor.
- **Dry-run planning** – Clients can request a dry-run to inspect schemas before executing code.
- **Sandboxed execution** – JavaScript runs inside Node's `vm` module with captured console logs
  and structured traces.
- **Traceability** – Responses include a human readable timeline mirroring the observability
  guidance from the MCP article.

## Getting started

```bash
npm install
npm run dev
```

The interactive demo lives at `http://localhost:3000` once the dev server starts.

## Project structure

- `app/page.tsx` – React UI for exploring tools, running dry-runs, and executing snippets.
- `app/api/tools/route.ts` – Lists registered tools in the host.
- `app/api/execute/route.ts` – Performs dry-runs or executes the selected tool.
- `lib/tools.ts` – Implements the tool registry and the sandboxed VM helper.
