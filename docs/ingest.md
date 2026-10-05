# Ingest

How files get from disk into the hybrid index.

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
