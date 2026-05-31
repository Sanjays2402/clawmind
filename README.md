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
- History export: download every past ask as `.json`, `.csv`, or `.md`, with the same search and namespace filters the History page is showing
- Feedback (thumbs / notes) on answers, used to mark good or bad chunks
- Digests: scheduled recurring queries (e.g. "what changed this week in projects/")
- Stale source detection (files indexed but not seen on disk recently)
- Related-document lookup and basic stats / doctor endpoints
- API keys with per-key rate limiting, GitHub OAuth or single-user mode
- Outbound webhooks: register a URL, get signed POSTs on `ask.completed` and `ingest.completed`, with automatic retries and a delivery log
- Shareable read-only answer links
- Installable PWA: web app manifest, offline shell, and in-app install prompt so the web UI lives on your home screen with quick shortcuts to Ask, Search, and Saved
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

### Try it in 30 seconds

Ingest the bundled sample knowledge pack and open the live demo page. It ships three preloaded sample questions you can click to see real retrieval, streaming answers, and inline citation chips against your local model. Each citation in the answer is clickable: it highlights the matching source card in the rail and scrolls it into view, and clicking a source card lights up every citation in the answer that points at it.

```bash
pnpm clawmind ingest ./samples
pnpm dev
open http://127.0.0.1:7412/demo
```

Or open the retrieval explain page at <http://127.0.0.1:7412/explain> to see why each chunk was picked: raw BM25, raw dense cosine, normalised values, hybrid blend, lexical rerank, and MMR rank are all rendered as side-by-side bars. Sliders let you tune alpha, lambda, and k and re-run the same pipeline /v1/ask uses, without spending an LLM call.

Or browse <http://127.0.0.1:7412/history> to search every past question, expand the full answer with its cited source excerpts, and click "Ask again" to re-run any of them in the chat. Free-text and namespace filters call the same `/v1/history` endpoint server-side so the page stays fast even with thousands of entries:

```bash
curl 'http://127.0.0.1:7410/v1/history?q=kernel&namespaces=memory&limit=20'
```

Or open <http://127.0.0.1:7412> on a phone or in a Chromium browser and use the in-app prompt to install ClawMind as a Progressive Web App. The manifest, icons, and a network-aware offline shell are served from the web app, so a built (`pnpm --filter @clawmind/web build`) deploy gets you home-screen launch, standalone window, and a graceful `/offline` page when the API is unreachable:

```bash
curl -s http://127.0.0.1:7412/manifest.webmanifest | jq '{name, start_url, display}'
```

Or hit the streaming endpoint directly:

```bash
curl -N -X POST http://127.0.0.1:7410/v1/ask/stream \
  -H 'content-type: application/json' \
  -d '{"q":"Summarize the kernel panic incidents and how the machine was recovered","namespaces":["memory"]}'
```

Or inspect retrieval scoring without calling the LLM:

```bash
curl -s -X POST http://127.0.0.1:7410/v1/explain \
  -H 'content-type: application/json' \
  -d '{"q":"LanceDB hybrid retrieval with MMR","k":5,"hybridAlpha":0.5}' | jq '.candidates[0]'
```

Multi-turn chat at <http://127.0.0.1:7412/conversations> keeps a rolling thread on disk, rewrites follow-ups so retrieval stays on topic, and now streams tokens live so each turn feels responsive. Drive it from the CLI:

```bash
CID=$(curl -s -X POST http://127.0.0.1:7410/v1/conversations \
  -H 'content-type: application/json' -d '{"title":"recap"}' | jq -r .conversation.id)
curl -N -X POST http://127.0.0.1:7410/v1/conversations/$CID/ask/stream \
  -H 'content-type: application/json' \
  -d '{"q":"what changed in projects this week?","namespaces":["memory","projects"]}'
```

For Docker, see `infra/docker/docker-compose.dev.yml` which brings up `redis`, `embed`, `api`, and `web`.

### Export a conversation

Every conversation can be downloaded in three formats from the toolbar on `/conversations/<id>`, or fetched directly:

```sh
curl -OJ http://127.0.0.1:7410/v1/conversations/$CID/export.md
curl -OJ http://127.0.0.1:7410/v1/conversations/$CID/export.json
curl -OJ http://127.0.0.1:7410/v1/conversations/$CID/export.csv
```

Markdown is for humans, JSON keeps the full structured payload with sources and scores, and CSV is one row per turn for spreadsheet review.

### Export your history

The History page (`http://127.0.0.1:7412/history`) has an Export menu that downloads every past ask in `.json`, `.csv`, or `.md`. Filters from the search box and namespace pills are passed through, so you only get what you are looking at. The same endpoint is available over the API:

```sh
# Everything
curl -OJ 'http://127.0.0.1:7410/v1/history/export.json'

# Spreadsheet-friendly, only memory + projects, matching "kernel"
curl -OJ 'http://127.0.0.1:7410/v1/history/export.csv?q=kernel&namespaces=memory,projects&limit=500'

# Markdown digest of the last 50 answers
curl -OJ 'http://127.0.0.1:7410/v1/history/export.md?limit=50'
```

### Webhooks

Wire your own service into ClawMind without polling. Register a receiver at <http://127.0.0.1:7412/webhooks>, pick the events you care about, and copy the signing secret (shown once). Every event becomes a real HTTPS POST signed with `X-ClawMind-Signature: t=<unix-ms>,v1=<hex(hmac_sha256(secret, t + "." + body))>`. Failures on 5xx or network errors retry up to three times with exponential backoff, and every attempt lands in the delivery log table on the same page.

Headless flow:

```bash
# Create a subscription; copy the returned `webhook.secret` once.
curl -s -X POST http://127.0.0.1:7410/v1/webhooks \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/hooks/clawmind","events":["ask.completed"]}'

# Fire a synthetic event to validate the receiver.
curl -s -X POST http://127.0.0.1:7410/v1/webhooks/<wh_id>/test

# Inspect recent deliveries (status, attempt, duration, error).
curl -s http://127.0.0.1:7410/v1/webhooks/deliveries | jq '.items[0]'
```

Verify a delivery from your receiver in Node:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(secret: string, body: string, header: string) {
  const [t, v1] = header.split(',').map((kv) => kv.split('=')[1]);
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))
    && Math.abs(Date.now() - Number(t)) < 5 * 60_000;
}
```

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
| `CLAWMIND_SENTRY_DSN` | empty | Sentry DSN; empty disables the SDK |
| `CLAWMIND_SENTRY_ENVIRONMENT` | `development` | Sentry environment tag |
| `CLAWMIND_SENTRY_RELEASE` | empty | Release tag, usually the git sha |
| `CLAWMIND_SENTRY_TRACES_SAMPLE_RATE` | `0` | Sentry performance trace sampling |
| `CLAWMIND_AUDIT_MAX_BYTES` | `33554432` | Rotate `audit.log` once it exceeds this many bytes; `0` disables in-process rotation |
| `CLAWMIND_AUDIT_KEEP_FILES` | `5` | Rotated audit log generations to retain (`audit.log.1` .. `audit.log.N`) |

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
- `POST /v1/explain` – same retrieval, returns per-chunk BM25 / dense / hybrid / rerank / MMR scores and stage funnel counts (no LLM call)
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
- `GET /v1/conversations/:id/export.json`
- `GET /v1/conversations/:id/export.csv`
- `POST /v1/conversations/:id/archive` | `/unarchive`
- `POST /v1/conversations/:id/fork`
- `POST /v1/conversations/:id/ask`
- `POST /v1/conversations/:id/ask/stream` (SSE: `rewrite`, `sources`, `token`, `error`)

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
- `GET /v1/me/export` – download every per-user record as JSON
- `DELETE /v1/me/data` – erase every per-user record, body `{"confirm":"DELETE"}`

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

## Operations

Deploy targets are the Helm chart in `infra/helm/clawmind` and the Docker
images built from `infra/docker/*.Dockerfile`. The API is stateless apart
from the LanceDB and BM25 files under `CLAWMIND_DATA_DIR`, which the chart
mounts from a PersistentVolumeClaim.

Container images:

- `infra/docker/api.Dockerfile` is a real multi-stage build. The `deps`
  and `build` stages install the full pnpm workspace and compile the api
  with `tsc`. A separate `prod` stage re-installs production-only deps
  (`pnpm install --prod --frozen-lockfile --ignore-scripts`) so no
  devDependency leaks. `pnpm --filter @clawmind/api deploy --prod`
  flattens the api package plus its workspace deps into `/out`, and the
  final `runtime` stage copies only `package.json`, `node_modules`, and
  `dist` into a fresh `node:20-alpine`. Source, tsconfig, turbo, pnpm,
  and the lockfile do not exist in the shipped image.
- The runtime image runs as uid 10001 (`USER cm`), uses `tini` as PID 1
  so signals reach Node and zombies get reaped, and ships a container
  `HEALTHCHECK` against `/live`. `NODE_ENV=production` and
  `CLAWMIND_API_HOST=0.0.0.0` are baked in so the container boots
  cleanly under Kubernetes without extra env wiring.
- `apps/api/test/api-dockerfile.test.ts` freezes these properties in CI
  (no docker daemon required) so a future edit that re-introduces source
  or drops the non-root user fails the build.
- Build locally with
  `docker build -f infra/docker/api.Dockerfile -t clawmind-api:dev .`
  from the repo root.

Health endpoints:

- `GET /live` is the Kubernetes liveness target. Always returns 200 with
  `{ "ok": true }` and performs zero downstream calls, so a slow or
  degraded embed sidecar, LLM provider, or storage layer cannot cascade
  into pod restarts. The Helm chart points the api livenessProbe here.
- `GET /ready` is readiness. Returns 200 once LanceDB, BM25, and the
  ingest manifest are loaded, 503 before that. The Service does not
  route to the pod until this passes.
- `GET /health` is a deeper status endpoint for dashboards and on-call.
  It reports embed and LLM health, chunk count, BM25 size, and document
  count. Do not use it as a livenessProbe; it intentionally fans out to
  dependencies and can stall.
- `GET /version` returns the build name and version.

Metrics:

- `GET /metrics` returns Prometheus text exposition format (version
  0.0.4). Scrape with a `ServiceMonitor` or plain Prometheus job. Series
  exposed include `http_requests_total{method,route,status}`,
  `http_requests_errors_total`, the
  `http_request_duration_seconds` histogram with buckets from 5 ms to
  10 s, plus `process_resident_memory_bytes`, `nodejs_heap_used_bytes`,
  and `process_uptime_seconds`. Cardinality is bounded by labelling on
  the Fastify route template, not the raw URL.
- `GET /metrics` with `Accept: application/json`, or `GET /metrics.json`,
  returns the legacy JSON snapshot for dashboards that have not moved to
  Prometheus yet.

Logs and traces:

- Structured JSON logs via pino. Each request gets a request id from
  Fastify and is attached to the log context as `requestId`.
- Request id propagation: the API honours an inbound `X-Request-Id`
  header when it matches `^[A-Za-z0-9_.:-]{8,128}$` so an upstream
  gateway, load balancer, or calling service can join logs across hops.
  Otherwise a fresh `req_` prefixed nanoid is minted. The chosen id is
  echoed back on every response as `X-Request-Id` and is recorded on
  every audit row under `meta.requestId`, so logs, audit, Sentry events,
  and the client trace all join on the same key.
- OpenTelemetry tracing is opt-in via `CLAWMIND_OTEL_ENABLED=true` and
  `CLAWMIND_OTEL_ENDPOINT`. Trace ids propagate into the log lines.

Error tracking (Sentry):

- Set `CLAWMIND_SENTRY_DSN` to enable. With the DSN empty the SDK never
  initialises and zero events are sent, so dev and test runs stay offline.
- The Fastify `sentryPlugin` reports every 5xx response and every uncaught
  error handler invocation. 4xx responses are intentionally skipped to keep
  validation noise out of the issue tracker; those still land in the audit
  log and structured logs.
- Each event carries the Fastify request id, the route template (not the
  raw URL, so query strings stay out of the payload), the client IP, and
  the HTTP status. When a user is authenticated the event is tagged with
  their user id and GitHub login.
- `req.captureException(err, extra?)` is exposed on every request for
  routes that want to capture handled errors with extra context.
- `CLAWMIND_SENTRY_ENVIRONMENT` (default `development`) and
  `CLAWMIND_SENTRY_RELEASE` map to the standard Sentry fields.
  `CLAWMIND_SENTRY_TRACES_SAMPLE_RATE` controls performance trace sampling
  and defaults to `0`.
- On graceful shutdown the plugin flushes the Sentry queue with a 1.5 s
  budget so in-flight events leave the pod before SIGTERM kills the
  process.

Audit log:

- Mutating requests and any non-2xx response are appended to the audit
  log at `${CLAWMIND_DATA_DIR}/audit.log` by the `auditPlugin`. Each row
  carries actor, action, resource, and request IP.
- Compliance review uses `GET /v1/admin/audit`. The route requires the
  `owner` role and the `audit:read` scope, so a narrowly scoped API key
  cannot tail user activity. Supported query parameters are `actor`
  (exact match), `action` (substring match), `resource` (path prefix
  match), `since` and `until` (epoch ms window), and `limit` / `offset`
  for paging. `limit` is capped at 1000. Results are newest first and
  the response shape is `{ total, events }`. The query itself is
  appended to the log with `action: audit.query`, so a reviewer
  inspecting the trail always leaves their own footprint in it.
- For very large logs, the `AuditLog` rotates `audit.log` in process.
  Once the active file exceeds `CLAWMIND_AUDIT_MAX_BYTES` (default 32 MiB)
  it is renamed to `audit.log.1`, older rotations shift up (`.1` -> `.2`,
  ...), and anything past `CLAWMIND_AUDIT_KEEP_FILES` (default 5) is
  deleted. Set `CLAWMIND_AUDIT_MAX_BYTES=0` to disable in-process
  rotation and hand off to external tooling (logrotate, a k8s sidecar,
  shipping to object storage). The query endpoint reads the active file
  plus every retained rotation so a window that crosses a rotation
  boundary still returns the right events; it is intended for incident
  response rather than analytics and caps a single response at 1000 rows.
- Each row is part of a sha256 hash chain. On write, the previous row's
  hash is stored in `prevHash` and a new `hash` is computed over a
  canonical serialisation of the row (meta keys sorted, hash field
  excluded). The first row in any chain commits to the sentinel
  `genesis`. `GET /v1/admin/audit/verify` replays the chain across the
  active log and every retained rotation, returns
  `{ ok, checked, firstBadIndex, reason, headHash }`, and self-logs the
  call with `action: audit.verify`. An on-call procedure for tamper
  evidence is: (1) after a security event, snapshot the current
  `headHash` from `/v1/admin/audit/verify` and stash it in the incident
  ticket; (2) anchor that head externally if you want non-repudiation
  (commit hash to a ticket, notarise, ship to write-once storage);
  (3) re-run verify later, and if `ok=false` or `headHash` changed for
  a record at or before the anchored point, the on-disk log was
  tampered with. The chain tolerates a legacy unchained prefix (rows
  written before this feature carry no hash and are skipped without
  failing verify) so an upgrade in place does not falsely flag the
  existing log.

Rate limits:

- Global ceiling of 240 requests per minute, keyed on API key id, then
  session user, then client IP. Hot routes such as `/v1/ask` apply a
  tighter per-route budget on top.

API key scopes:

- Every gated route declares a scope from `apps/api/src/scopes.ts`. The
  full catalogue is also exposed at `GET /v1/keys/scopes` so a UI can
  render checkboxes when issuing a key.
- Scopes follow `<resource>:<action>` where action is one of `read`,
  `write`, or `admin`. Examples: `search:read`, `ingest:write`,
  `lifecycle:admin`. The wildcard `*` grants every scope and is the
  intended choice for trusted automation that needs the whole surface.
- A key with an empty scope list is treated as unrestricted for
  backwards compatibility, matching the long-standing behaviour of
  `services/api-keys.ts#hasScope`. A key with at least one scope is
  restricted to that set; the `requireScope` preHandler returns 403 on
  any route that asks for a scope not in the list.
- `POST /v1/keys` validates submitted scopes against the registry and
  rejects typos with HTTP 400, so a key cannot silently look
  restrictive while in practice gating nothing. Session-cookie users
  bypass the scope check (they are intentionally unscoped); scope
  enforcement only applies to API key requests.
- Coverage is enforced by `apps/api/test/scopes.test.ts`, which asserts
  that no route file leaves a bare `requireAuth` or `requireRole`
  preHandler in place and that every `requireScope()` argument resolves
  to a known scope. Adding a new route without a scope fails the build.

Scaling:

- The API is horizontally scalable as long as all replicas share the
  same `CLAWMIND_DATA_DIR` volume (ReadWriteMany) or you front a single
  writer with read replicas. Set `api.replicas` in the Helm values.
- Embed sidecar is CPU bound. Scale `embed.replicas` and put a Service
  in front of it so the API load balances across pods.

Security headers:

- The API ships an in-process `security-headers` plugin (`apps/api/src/plugins/security-headers.ts`)
  that stamps a JSON-API baseline on every response: `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` denying camera, microphone, geolocation, and the
  legacy `interest-cohort` token, plus `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Resource-Policy` both pinned to `same-origin`.
- The default `Content-Security-Policy` is `default-src 'none'; frame-ancestors
  'none'; base-uri 'none'; form-action 'none'`. The API only serves JSON and
  never returns user supplied HTML, so this policy is safe to leave on. The
  Next.js web client is a separate origin and is not affected.
- `Strict-Transport-Security` is opt-in via `CLAWMIND_HSTS_ENABLED=true`
  because the default bind is plain HTTP on `127.0.0.1`. Enable it once the
  API is behind a TLS terminating ingress. `CLAWMIND_HSTS_MAX_AGE_SECONDS`
  controls the max-age (default 180 days, `includeSubDomains` on).
- Headers are applied via the `onSend` hook so they also appear on error
  responses, including 4xx/5xx coming from Fastify itself. Coverage lives in
  `apps/api/test/security-headers.test.ts`.

Helm hardening:

- The chart defaults are safe but minimal. Production overlays should set
  `api.autoscaling.enabled=true` (and optionally `web.autoscaling.enabled=true`)
  to enable the `HorizontalPodAutoscaler`. CPU target defaults to 75 percent
  and memory to 80 percent; tune via `api.autoscaling.targetCPUUtilizationPercentage`
  and `targetMemoryUtilizationPercentage`. The HPA replaces the static
  `replicas` field, so do not set both.
- `api.pdb.enabled`, `web.pdb.enabled`, and `embed.pdb.enabled` install a
  `PodDisruptionBudget` with `minAvailable: 1` per service. Turn these on
  before node drains during cluster upgrades.
- `networkPolicy.enabled=true` installs three `NetworkPolicy` objects:
  the API accepts traffic from `clawmind-web` and any pod labelled
  `clawmind.io/allow: api`; the web pod accepts the same set; the embed
  pod only accepts traffic from the API. Add ingress controllers via
  `networkPolicy.extraIngressNamespaceSelectors`. Set
  `networkPolicy.allowEgressToInternet=false` for fully air-gapped deploys.
- Every workload runs as `runAsNonRoot` UID 10001, drops `ALL` capabilities,
  and uses the `RuntimeDefault` seccomp profile. These satisfy the
  Pod Security Standards `restricted` profile.
- Resource limits are set for `api`, `web`, and `embed`. The embed sidecar
  defaults to 1 CPU and 2 GiB memory because the BGE model preload is the
  hot path; raise this for larger models.
- The chart is covered by `apps/api/test/helm-chart.test.ts` which shells
  out to `helm template` and asserts default vs hardened renders. Skipped
  when the `helm` CLI is not on PATH.

Prometheus Operator integration:

- `monitoring.serviceMonitor.enabled=true` installs a `ServiceMonitor` that
  scrapes the API Service on the named `http` port at `/metrics`. Set
  `monitoring.serviceMonitor.labels` to the label your Prometheus instance
  uses for `serviceMonitorSelector` (for kube-prometheus-stack the
  convention is `release: kube-prometheus-stack`). `interval` and
  `scrapeTimeout` default to 30s and 10s respectively, and
  `relabelings` / `metricRelabelings` pass through for advanced topologies.
- `monitoring.prometheusRule.enabled=true` installs a `PrometheusRule`
  with the four alerts listed under On-call below: `ClawmindApiDown`,
  `ClawmindApiHighErrorRate`, `ClawmindApiAskLatencyHigh`, and
  `ClawmindApiReadinessFlapping`. Thresholds and rate windows are tunable
  via `monitoring.prometheusRule.thresholds.*` so you can match them to
  your traffic profile without forking the chart. Every alert carries a
  `severity` label (`critical` or `warning`), a `service: clawmind-api`
  label for Alertmanager routing, and a `runbook` annotation pointing
  back to this section.
- Both objects are off by default and only render when their flag is
  flipped, so the chart still installs cleanly on clusters that do not
  have the `monitoring.coreos.com` CRDs registered. Coverage is locked
  down by `apps/api/test/helm-chart.test.ts`.

Backup and restore:

- The only stateful directory is `CLAWMIND_DATA_DIR`. Snapshot the PVC
  on a schedule (Velero, restic, or your cloud provider snapshotter).
- To restore: stop the API replicas, restore the volume, restart.
  Ingest is idempotent so a partial restore can be reconciled by
  re-running `clawmind ingest` against the source workspace.

Data lifecycle (GDPR):

- `GET /v1/me/export` returns a JSON bundle of every per-user record
  (history, conversations, saved searches, feedback votes, and API key
  metadata with hashes redacted). Served with a `Content-Disposition`
  attachment header so curl and browsers save it as a file. The export
  is written to the audit log with row counts.
- `DELETE /v1/me/data` erases every per-user record and returns a
  deletion report with counts. Body must be `{"confirm": "DELETE"}`.
  Shared feedback entries are updated in place: the calling user's vote
  is removed and counts are decremented, and entries that go to zero are
  dropped. Workspace scoped state (pins, mutes, aliases, tags, the
  ingest manifest, the embedding index) is left intact because it is
  shared across users. The deletion is written to the audit log.
- Both endpoints require authentication and are scoped to the calling
  user. There is no admin override that deletes another user's data
  from the API surface; operators do that by stopping the API and
  editing the data directory directly.

Continuous integration:

- The pipeline lives in `.github/workflows/ci.yml` and is gated behind the
  repository variable `ENABLE_CI=true`. The `guard` job emits an `enabled`
  output and every real job (`verify`, `audit`, `docker`) refuses to run
  unless that output is `'true'`. This keeps the gate honest: there is no
  silent skip, the gating expression is the same string in every job.
- `verify` runs `pnpm install --frozen-lockfile` then `pnpm typecheck`,
  `pnpm test`, and `pnpm build` end to end. A green run means the entire
  workspace typechecks, every package test suite passes, and every build
  target produces its declared `outputs`.
- `audit` runs `pnpm audit --prod --audit-level high`, so any high or
  critical advisory in a production dependency fails the build. Moderate
  and low advisories surface in the log without blocking.
- `docker` builds the `api`, `web`, and `embed` images from
  `infra/docker/*.Dockerfile` via `docker/build-push-action` with a GHA
  layer cache. The images are built but not pushed; this catches
  Dockerfile regressions before they hit `release.yml`.
- The workflow shape is locked down by `apps/api/test/ci-workflow.test.ts`
  so accidental edits (dropping the audit job, ungating a step, deleting
  a Dockerfile from the matrix) fail in `pnpm test` before they ship.

On-call:

- The four alerts shipped by `monitoring.prometheusRule.enabled=true`
  encode this section directly:
  - `ClawmindApiDown` pages when no API scrape target has been `up` for
    `thresholds.downFor` (default 2m).
  - `ClawmindApiHighErrorRate` pages on sustained
    `http_requests_errors_total` rate above `thresholds.errorRatePerSecond`
    over `thresholds.errorRateWindow`.
  - `ClawmindApiAskLatencyHigh` warns when the p95 of
    `http_request_duration_seconds_bucket{route="/v1/ask"}` exceeds
    `thresholds.askP95Seconds` (default 1s).
  - `ClawmindApiReadinessFlapping` warns when
    `kube_pod_container_status_ready` for the API container changes more
    than `thresholds.flapChanges` times in `thresholds.flapWindow`.
- Audit log growth stalling (indicating the writer is wedged) is not yet
  shipped as a built-in alert because it depends on whether you ship the
  audit log to a sidecar; add it as an extra rule in your own overlay.

## License

MIT. See `LICENSE`.
