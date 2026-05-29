# CLI

```text
clawmind ingest [root]    Index a directory tree (defaults to your workspace)
clawmind ask <question>   Ask a question, stream the answer with citations
clawmind search <query>   Hybrid retrieval only
clawmind reindex [root]   Drop the manifest and BM25, then re-ingest
clawmind watch [root]     Watch and incrementally reindex on file changes
clawmind status           Print provider health and index counts
```

Flags worth knowing:

- `--k <n>` for top-k chunks on `ask` and `search`.
- `--namespaces memory,projects` to scope retrieval.

Dogfood example:

```bash
clawmind ask "what did I commit last Tuesday on snip?"
```
