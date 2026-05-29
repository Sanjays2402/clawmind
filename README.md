# ClawMind

Local-first RAG over your OpenClaw workspace. Ask in natural language, get cited answers grounded in your own notes, projects, and session logs.

ClawMind runs entirely on your Mac. Embeddings come from Apple MLX through a tiny Python sidecar. Vectors live in LanceDB. The retrieval pipeline uses hybrid BM25 plus dense search with MMR rerank, then streams answers through a local LLM (hermes-agent by default, with a GitHub Copilot proxy as fallback).

## What you get

- A Fastify REST API with zod-validated routes, audit logs, and OAuth.
- A Next.js 15 chat UI with citation chips that jump to file:line.
- A `clawmind` CLI you can pipe into anything.
- An incremental ingest watcher that follows your workspace.

## Quick start

```bash
pnpm install
pnpm --filter @clawmind/embed python:setup
pnpm clawmind ingest ~/.openclaw/workspace
pnpm clawmind ask "what did I commit last Tuesday on snip?"
```

For the full setup, see `docs/getting-started.md`.

## Architecture

See `docs/architecture.md` for the data flow, schemas, and provider abstraction.

## License

MIT.
