# Getting started

ClawMind expects:

- macOS 14 or newer (for MLX) or any Linux box for the fallback path.
- Node 20.10 or newer.
- Python 3.11 for the embedding sidecar.
- pnpm 9.

Install and seed the workspace:

```bash
pnpm install
pnpm --filter @clawmind/embed python:setup
pnpm --filter @clawmind/embed python:serve &
pnpm clawmind ingest ~/.openclaw/workspace
pnpm clawmind ask "what is the snip project about?"
```

The first run downloads the embedding model. Subsequent runs are instant.

Run the API and web UI side by side:

```bash
pnpm dev
```

Then open http://127.0.0.1:7412.
