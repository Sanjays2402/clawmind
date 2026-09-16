# CLI

Run the CLI from the repo root with `pnpm clawmind <command>`. Every command
accepts `--help` for its full flag list.

## Indexing

```text
clawmind ingest [root]    Index a directory tree (defaults to your workspace)
clawmind watch [root]     Watch and incrementally reindex on file changes
clawmind reindex [root]   Drop the manifest and BM25, then re-ingest
clawmind forget <glob>    Remove indexed sources by glob pattern (manifest, BM25, vector store)
clawmind compact          Prune manifest, BM25, and LanceDB entries for files that no longer exist
```

Flags worth knowing:

- `ingest --since <iso-date>` refreshes only files changed since the cutoff; add `--dry-run` to preview (`--paths-only` for an xargs-safe path list, `--slim` for a compact `{count, since}` JSON shape).
- `watch --once` runs a single scan-and-ingest pass under the watcher's discovery rules (cron-friendly); `watch --debounce <ms>` coalesces rapid file events (default 800).

Dogfood example:

```bash
clawmind ask "what did I commit last Tuesday on snip?"
```

## Retrieval

```text
clawmind ask <question>       Ask a question, stream the answer with citations
clawmind search <query>       Hybrid retrieval only (no LLM generation)
clawmind related <path>       Sources semantically similar to an indexed path
```

Worth knowing:

- `--k <n>` for top-k chunks on `ask` and `search`.
- `--namespaces memory,projects` to scope retrieval.
- `--include-tags <list>` / `--exclude-tags <list>` filter sources by tag.
- `ask` streams the answer by default; `--json` emits the answer + citations as JSON, `--stream-json` emits NDJSON events, and `-t/--threshold <n>` skips the LLM call entirely when every retrieved source falls below the score bar.
- `search` supports `--json` (add `--slim` for a lean `{rank, path, score, namespace}` shape, or `--no-snippet` to keep `startLine` but drop snippets), `--tsv` (tab-separated `rank/path/score/namespace` rows, add `--header` for a schema row), and `--paths-only` for one path per line, deduped in rank order. Sort survivors with `--sort score|path|namespace` (plus `--reverse`); `-t/--threshold <n>` drops low-scoring hits. `-` as the query reads the full query from stdin for shell loops.
- `related` takes an indexed path instead of a query string; it mirrors `search`'s `--sort`/`--reverse`/`--json`/`--slim`/`--tsv`/`--paths-only` conventions.

## Curating the index

```text
clawmind tags                 Label sources with arbitrary tags for query-time filtering
clawmind pins                 Pin sources so retrieval always considers them strongly
clawmind mutes                Mute sources so retrieval pushes them to the back
clawmind feedback             Upvote, downvote, list, or clear source feedback
```

Worth knowing:

- `tags <add|set|remove|show|list|sources>`, `pins <add|remove|list>`, `mutes <add|remove|list>` all accept source paths (mutes accept `dir/**` globs).
- `feedback <up|down|clear|list|prune> <path>`: up/down votes bias the retrieval ranking toward or away from a path; `prune` bulk-clears entries below/above a boost threshold.

## Maintenance and insight

```text
clawmind status               Print index status and provider health
clawmind doctor               Diagnose drift between the manifest, BM25 index, and vector store
clawmind stats                Per-namespace index metrics (files, chunks, bytes)
clawmind stale                Sources that have not been re-ingested recently
clawmind digest               Re-run saved searches and show what changed
clawmind export <id>          Export a conversation (markdown, json, or csv)
clawmind aliases              Short, memorable names for long source paths
```

Worth knowing:

- `status --json` emits a machine-readable snapshot; add `--check` to exit non-zero when any probe is down (CI smoke-check friendly). `status --watch <ms>` repolls in place (TTY) or as NDJSON (`--json`), with `--max-polls <n>` for bounded loops and `--check-after <n>` to debounce the `--check` exit code until N consecutive down cycles.
- `stale --days <n>` (default 30) lists files older than the threshold; `--paths-only` makes the output pipe-ready for `xargs`.
- `digest <list|run|show>`: save recurring searches, run them, and diff the top-k against the last run to see what changed.
- `export <id> --format md|json|csv --since <iso-date>` narrows the export to turns at-or-after the cutoff (incremental dumps); `--slim` drops the body and reports `{format, since, bytes}` for polling "did this conversation grow?".
- `aliases <add|remove|list>` map short names like `@notes` to long workspace paths; the API expands them inside queries and cited paths.
