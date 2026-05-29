# Roadmap

Short list of things worth doing next.

- Persist BM25 to a real on-disk index. JSON works for tens of thousands of chunks; beyond that it gets slow to load.
- Add a tiny reranker call (cross-encoder) for the final top-k.
- Per-namespace embeddings (code vs prose) for sharper retrieval.
- Optional Postgres backend for history and saved items.
- A small mobile-friendly chat view.
