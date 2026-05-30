# ClawMind

Local-first RAG over your notes, sessions, and project files. Ask questions, get cited answers.

![landing](docs/screenshots/landing.png)

## What it does

ClawMind indexes a directory tree (default: `~/.openclaw/workspace`) into a hybrid retrieval store, then answers natural-language questions against it with inline citations to the source files. Documents are chunked, embedded with a local MLX model (with an OpenAI-compatible fallback), and written to LanceDB for dense search and a BM25 index for lexical search. Queries hit both, are merged and reranked, and the top chunks are passed to a configurable LLM (local Hermes by default, Copilot fallback) which produces a grounded answer. Files are automatically bucketed into namespaces (`memory`, `sessions`, `projects`, `docs`, `misc`) based on their path so you can scope retrieval. State lives on disk: nothing leaves the box unless you point it at a remote model.

## Features

- Hybrid retrieval: LanceDB dense vectors + BM25 lexical, merged with MMR
- Namespaces inferred from path (memory / sessions / projects / docs / misc) for scoped queries
- Streaming and non-streaming `/ask` with cited spans back to source files
- Saved searches with snapshot history so you can diff results over time
- Pins, mutes, and aliases to bias or exclude paths from retrieval
- Tags on files, browsable as facets
- Conversations: multi-turn threads with archive, fork, rename, and Markdown export
- Feedback (thumbs / notes) on answers, used to mark good or bad chunks
- Digests: scheduled recurring queries (e.g. "what changed this week in projects/")
- Stale source detection (files indexed but not seen on disk recently)
- Related-document lookup and basic stats / doctor endpoints
- API keys with per-key rate limiting, GitHub OAuth or single-user mode
- Shareable read-only answer links
- File watcher for incremental reindex
- Local MLX embeddings with automatic fallback to an OpenAI-compatible endpoint

## Stack

- Node 20+, TypeScript, pnpm workspaces, Turborepo
- API: Fastify 5, Zod, `@fastify/session`, `@fastify/rate-limit`
- Web: Next.js 15 (App Router), React 19, Tailwind v4
- CLI: commander, ora, kleur
- Vector store: LanceDB
- Lexical: in-process BM25 index persisted to JSON
- Embeddings: MLX sidecar (Python, FastAPI) serving `bge-small-en-v1.5-4bit` by default
- LLM: any OpenAI-compatible chat completions endpoint
- Telemetry: pino logging, optional OTLP traces
- Tests: vitest, Playwright (web e2e)

## Architecture

The repo is a pnpm workspace. `apps/api` is the Fastify HTTP service, `apps/web` is the Next.js UI, `apps/cli` is the `clawmind` command. Domain logic lives in `packages/*`: `ingest` (loaders, chunkers, watcher, manifest), `embed` (MLX + OpenAI clients with fallback), `store` (LanceDB wrapper, BM25 index, ingest manifest, audit log), `rag` (retrieval, MMR, prompt assembly), `llm` (chat clients), `config`, `types`, `telemetry`, and `ui`. Ingest walks the workspace, applies a gitignore-style filter, hashes each file against the manifest to skip unchanged content, loads it through a typed loader (markdown / code / json / pdf / html), chunks it with a sliding or semantic chunker, embeds each chunk, and writes vectors to LanceDB plus tokens to BM25. Query path: the API embeds the question, runs BM25 and dense KNN in parallel, merges with a hybrid alpha, applies MMR for diversity, builds a prompt under a token budget, and streams the LLM response back with citation spans pointing at `path` + line range.

```
                   ┌──────────────┐
files on disk ───▶ │  ingest      │ ─chunks─▶ embed sidecar (MLX)
                   │  pipeline    │              │
                   └──────┬───────┘              ▼
                          │                  vectors
                          ▼                      │
                   manifest.json                 ▼
                                          ┌───────────┐
                          ┌──tokens─────▶ │  LanceDB  │
                          ▼               └───────────┘
                     ┌─────────┐                ▲
                     │  BM25   │                │
                     └─────────┘                │
                          ▲                     │
                          └────── query ────────┘
                                    │
                                    ▼
                            hybrid merge + MMR
                                    │
                                    ▼
                            prompt + citations
                                    │
                                    ▼
                              LLM (Hermes /
                              Copilot fallback)
```

## Quick start

Requirements: Node 20.10+, pnpm 9, Python 3.11+ (for the embed sidecar), and an OpenAI-compatible chat endpoint reachable at `CLAWMIND_LLM_PRIMARY_URL`.

```bash
git clone https://github.com/Sanjays2402/clawmind.git
cd clawmind
pnpm install
cp .env.example .env

# Start the MLX embed sidecar (port 7411)
cd packages/embed/python
pip install -r requirements.txt
python server.py &
cd -

# Start API (7410) + Web (7412) + CLI in watch mode
pnpm dev

# In another shell, index your workspace
pnpm clawmind ingest ~/.openclaw/workspace

# Ask something
pnpm clawmind ask "what did I decide about the embed model last week?"
```

The web UI is at <http://127.0.0.1:7412>. The API listens on <http://127.0.0.1:7410>. Data (LanceDB, BM25 index, manifest, audit log) is written to `CLAWMIND_DATA_DIR` (default `./data`).

For Docker, see `infra/docker/docker-compose.dev.yml` which brings up `redis`, `embed`, `api`, and `web`.

## Configuration

All env vars are loaded via `envalid` in `packages/config`. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAWMIND_DATA_DIR` | `./data` | Where LanceDB, BM25, manifest, and audit log live |
| `CLAWMIND_WORKSPACE` | `~/.openclaw/workspace` | Default root passed to `clawmind ingest` |
| `CLAWMIND_LOG_LEVEL` | `info` | pino level |
| `CLAWMIND_API_HOST` | `127.0.0.1` | API bind host |
| `CLAWMIND_API_PORT` | `7410` | API port |
| `CLAWMIND_API_CORS_ORIGIN` | `http://127.0.0.1:7412` | CORS allowlist |
| `CLAWMIND_EMBED_URL` | `http://127.0.0.1:7411` | MLX embed sidecar |
| `CLAWMIND_EMBED_MODEL` | `mlx-community/bge-small-en-v1.5-4bit` | Embedding model id |
| `CLAWMIND_EMBED_DIM` | `384` | Vector dimension; must match the model |
| `CLAWMIND_LLM_PRIMARY_URL` | `http://127.0.0.1:8642/v1` | OpenAI-compatible chat endpoint |
| `CLAWMIND_LLM_PRIMARY_MODEL` | `hermes-agent` | Primary chat model id |
| `CLAWMIND_LLM_FALLBACK_URL` | `http://127.0.0.1:4141/v1` | Fallback chat endpoint (also used for OpenAI embedding fallback) |
| `CLAWMIND_LLM_FALLBACK_MODEL` | `copilot-gpt-4o` | Fallback chat model id |
| `CLAWMIND_AUTH_MODE` | `single-user` | `single-user` or `github` |
| `CLAWMIND_SESSION_SECRET` | (dev default) | Session cookie secret, 32 bytes in prod |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | empty | Required when `AUTH_MODE=github` |
| `CLAWMIND_ALLOWED_GITHUB_USERS` | empty | Comma list of GitHub logins permitted to log in |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:7410` | Used by the web app |
| `CLAWMIND_OTEL_ENABLED` | `false` | Enable OTLP traces |
| `CLAWMIND_OTEL_ENDPOINT` | `http://127.0.0.1:4318` | OTLP collector |

## Scripts

Root (`package.json`):

| Script | What it runs |
| --- | --- |
| `pnpm dev` | `turbo run dev --parallel` (api + web + cli watch) |
| `pnpm build` | `turbo run build` |
| `pnpm lint` | `turbo run lint` |
| `pnpm test` | `turbo run test` |
| `pnpm typecheck` | `turbo run typecheck` |
| `pnpm format` | `prettier --write .` |
| `pnpm clawmind` | Runs the workspace CLI (`@clawmind/cli`) |

Per-app: each `apps/*` and `packages/*` has its own `dev`, `build`, `test`, `typecheck`. The web app's `dev` script binds to `127.0.0.1:7412`. The API's `dev` is `tsx watch src/server.ts`. The web app also has `pnpm --filter @clawmind/web e2e` for Playwright.

Helper shell scripts in `scripts/`:

- `dev.sh` – spin up the full local stack
- `seed.sh` – ingest `samples/` for a quick demo
- `check-secrets.sh` – grep for committed secrets
- `release.sh` – tag + publish
- `measure-retrieval.ts` – run the eval harness in `eval/`

## API

All routes are mounted under `/v1` except health.

Health and meta:
- `GET /health`
- `GET /metrics`
- `GET /version`
- `GET /v1/doctor`
- `GET /v1/stats`

Retrieval and generation:
- `POST /v1/search` – hybrid search, returns ranked chunks
- `POST /v1/ask` – RAG answer with citations
- `POST /v1/ask/stream` – SSE streaming variant
- `GET /v1/ask/cache/stats`
- `POST /v1/ask/cache/clear`
- `GET /v1/related` – related documents for a path

Ingest and sources:
- `POST /v1/ingest` – kick off an ingest for a path
- `GET /v1/ingest/status`
- `GET /v1/sources` – list indexed sources
- `GET /v1/sources/file?path=&start=&end=` – read a span of a source file
- `GET /v1/sources/stale?olderThanDays=&limit=`

Conversations:
- `GET /v1/conversations?archived=`
- `POST /v1/conversations`
- `GET /v1/conversations/:id`
- `PATCH /v1/conversations/:id` (rename)
- `DELETE /v1/conversations/:id`
- `GET /v1/conversations/:id/export.md`
- `POST /v1/conversations/:id/archive` | `/unarchive`
- `POST /v1/conversations/:id/fork`
- `POST /v1/conversations/:id/ask`

Saved searches and snapshots:
- `GET|POST /v1/saved`, `DELETE /v1/saved/:id`
- `GET /v1/saved/:savedId/snapshots`
- `POST /v1/saved/:savedId/snapshots`
- `GET|DELETE /v1/saved/:savedId/snapshots/:id`
- `POST /v1/saved/:savedId/snapshots/:id` (rerun / promote)

History, share, feedback:
- `GET|DELETE /v1/history`
- `POST /v1/share`, `GET /v1/share/:id`
- `GET|POST|DELETE /v1/feedback`

Curation:
- `GET|POST|DELETE /v1/pins`
- `GET|POST|DELETE /v1/mutes`
- `GET|POST|DELETE /v1/aliases`
- `GET /v1/tags`, `GET /v1/tags/:tag`
- `GET|PUT|POST|DELETE /v1/tags/by-path?path=`

Digests:
- `GET /v1/digests`
- `GET /v1/digests/:id`
- `POST /v1/digests/:id/run`
- `POST /v1/digests/run`

Auth and admin:
- `GET|POST /v1/keys`, `DELETE /v1/keys/:id`
- `POST /v1/maintenance/compact`
- `POST /v1/maintenance/forget`

Requests are rate-limited globally to 240/min, keyed by API key id, session user, or IP in that order.

## Ingest

Two ways to add documents.

CLI (preferred for local use):

```bash
# Index the default workspace from .env
pnpm clawmind ingest

# Index an arbitrary tree
pnpm clawmind ingest ~/code/notes

# Watch for changes
pnpm clawmind watch ~/code/notes

# Drop a file or a glob from the index
pnpm clawmind forget ~/code/notes/secret.md

# Rebuild from scratch (clears manifest)
pnpm clawmind reindex

# Compact LanceDB
pnpm clawmind compact
```

HTTP:

```bash
curl -X POST http://127.0.0.1:7410/v1/ingest \
  -H 'content-type: application/json' \
  -d '{"path": "/Users/sanjay/code/notes"}'

curl http://127.0.0.1:7410/v1/ingest/status
```

The pipeline:

1. Walk `path` honoring `.gitignore` plus built-in skip rules (`node_modules`, `.next`, binaries, etc.).
2. Hash each file and compare against `data/ingest-manifest.json`; skip unchanged.
3. Dispatch to a loader by extension (`.md`, code, `.json`, `.pdf`, `.html`).
4. Chunk with the sliding chunker (`targetTokens: 320`, `overlapTokens: 48`) or the semantic chunker for markdown.
5. Infer namespace from path (`memory` / `sessions` / `projects` / `docs` / `misc`).
6. Embed each chunk via MLX, fall back to OpenAI-compatible embeddings on failure.
7. Upsert vectors into LanceDB and tokens into the BM25 index.
8. Append an entry to `data/audit.log`.

Ask example:

```bash
curl -X POST http://127.0.0.1:7410/v1/ask \
  -H 'content-type: application/json' \
  -d '{
    "question": "what did I decide about the embed model?",
    "namespaces": ["memory", "docs"],
    "k": 8
  }'
```

## Project structure

```
.
├── apps/
│   ├── api/         Fastify HTTP service (port 7410)
│   ├── cli/         `clawmind` command
│   └── web/         Next.js 15 UI (port 7412)
├── packages/
│   ├── config/      env loading, paths, defaults
│   ├── embed/       MLX + OpenAI embed clients, Python sidecar in python/
│   ├── ingest/      loaders, chunkers, pipeline, watcher, manifest
│   ├── llm/         OpenAI-compatible chat clients with fallback
│   ├── rag/         hybrid retrieval, MMR, prompt assembly
│   ├── store/       LanceDB wrapper, BM25 index, manifest, audit log
│   ├── telemetry/   pino logger, OTLP tracing
│   ├── types/       shared zod schemas and TS types
│   └── ui/          shared React components
├── infra/
│   ├── docker/      Dockerfiles + docker-compose.dev.yml
│   ├── helm/        chart skeleton
│   └── terraform/   modules + envs
├── eval/            retrieval eval fixtures + questions
├── samples/         sample workspace for `scripts/seed.sh`
├── scripts/         dev.sh, seed.sh, release.sh, etc.
├── docs/            additional docs and screenshots
└── turbo.json
```

## License

MIT. See `LICENSE`.
