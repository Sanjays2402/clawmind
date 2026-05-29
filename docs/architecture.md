# Architecture

ClawMind is split into:

- A Python embedding sidecar on port 7411. MLX on Apple Silicon, sentence-transformers everywhere else.
- A Fastify REST API on port 7410. Hybrid retrieval, streaming chat, history, saved questions, share links.
- A Next.js 15 web UI on port 7412. Chat shell with a sources pane and citation chips.
- A `clawmind` CLI you can invoke from anywhere.

## Data flow

1. The ingest pipeline walks your workspace, classifies each file into a namespace (memory, projects, sessions, docs, misc), chunks it semantically, then embeds and writes to LanceDB plus an in-memory BM25 index.
2. A query hits both BM25 and LanceDB in parallel. The two result lists are min-max normalized then blended.
3. A lexical pass nudges chunks with literal query terms or compact passages up the list.
4. MMR rerank chooses a diverse top-k.
5. The selected chunks are formatted as a context block. The LLM (hermes-agent by default, Copilot proxy as fallback) streams an answer with [^n] citation markers.
6. The UI renders citations as chips that scroll the sources pane to the matching chunk.

## Storage

LanceDB lives at `data/lancedb`. BM25 lives at `data/bm25/bm25.json`. The ingest manifest tracks file hashes and mtimes so re-ingest only touches changes.

## Auth

Single-user mode is the default. Set `CLAWMIND_AUTH_MODE=github` and provide a GitHub OAuth client to enable multi-user mode. `CLAWMIND_ALLOWED_GITHUB_USERS` is a comma-separated allow list.
