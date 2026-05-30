# @clawmind/api

Fastify REST API for ClawMind.

Run with: `pnpm --filter @clawmind/api dev`.

## Routes

Core RAG:

- `POST /v1/ask` — one-shot question, returns answer + sources + citations.
- `POST /v1/ask/stream` — same, as Server-Sent Events.
- `POST /v1/search` — retrieval only, no LLM.
- `POST /v1/ingest` — incremental ingest of a path.
- `GET  /v1/sources` — list known documents.

History and saved searches:

- `GET  /v1/history`
- `GET  /v1/saved`, `POST /v1/saved`, `DELETE /v1/saved/:id`
- `POST /v1/share`, `GET /v1/share/:id`

Conversations (multi-turn with follow-up rewriting):

- `POST /v1/conversations`
- `GET  /v1/conversations`
- `GET  /v1/conversations/:id`
- `DELETE /v1/conversations/:id`
- `POST /v1/conversations/:id/ask`
- `POST /v1/conversations/:id/ask/stream`

Feedback (per-source upvote/downvote, fed back into hybrid scoring):

- `GET    /v1/feedback`
- `POST   /v1/feedback`   `{ path, vote: 1 | -1 }`
- `DELETE /v1/feedback`   `{ path }`

Digests (re-run saved searches and diff the top sources against last run):

- `GET  /v1/digests`
- `GET  /v1/digests/:id`
- `POST /v1/digests/:id/run`
- `POST /v1/digests/run`

Health:

- `GET /health`, `GET /metrics`, `GET /version`

## Notes

- Auth is `single-user` by default. Set `CLAWMIND_AUTH_MODE=github` and the
  `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` env vars to switch on GitHub
  OAuth.
- Conversation history is capped at 12 turns per thread on disk and the last
  6 turns are echoed into the prompt.
- Feedback boosts are clamped to `[0.5, 1.5]` so no single user can permanently
  pin or bury a source.
