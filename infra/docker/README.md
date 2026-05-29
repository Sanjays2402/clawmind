# ClawMind Docker

Three images:

- `api.Dockerfile`: the Fastify server.
- `web.Dockerfile`: the Next.js UI.
- `embed.Dockerfile`: the Python sidecar. On non-Apple-Silicon hosts it falls back to sentence-transformers.

For local dev:

```bash
docker compose -f infra/docker/docker-compose.dev.yml up --build
```
