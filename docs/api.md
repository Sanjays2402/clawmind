# REST API

Base URL: `http://127.0.0.1:7410`. All POST bodies are JSON. Auth uses session cookies.

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | /health | Provider health and counts |
| GET  | /version | Build version |
| POST | /v1/search | Hybrid retrieval only |
| POST | /v1/ask | Full ask, returns text + sources + citations |
| POST | /v1/ask/stream | Server-sent events with token deltas |
| POST | /v1/ingest | Trigger an ingest of a directory |
| GET  | /v1/ingest/status | Document and chunk counts |
| GET  | /v1/sources/file | Fetch a file slice |
| GET  | /v1/history | Recent questions |
| POST | /v1/saved | Pin a question |
| GET  | /v1/saved | List pinned |
| DEL  | /v1/saved/:id | Unpin |
| POST | /v1/share | Create a share link |
| GET  | /v1/share/:id | Read a share link |

Request bodies are validated with zod and return 400 with a useful error on failure.
