# Embed Sidecar

A tiny FastAPI service that exposes one POST endpoint, `/embed`, backed by MLX on Apple Silicon and sentence-transformers everywhere else.

Run it from the repo root:

```bash
pnpm --filter @clawmind/embed python:setup
pnpm --filter @clawmind/embed python:serve
```

The API expects:

```json
{ "texts": ["hello world"], "model": "mlx-community/bge-small-en-v1.5-4bit" }
```

and returns:

```json
{ "vectors": [[0.01, 0.02, ...]], "model": "...", "dim": 384 }
```

Vectors are L2-normalized server side so the downstream cosine math is just a dot product.
