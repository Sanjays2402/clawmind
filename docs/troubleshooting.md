# Troubleshooting

**The embed sidecar will not start on Linux.** That is expected for the MLX path. The loader falls back to sentence-transformers automatically. Set `CLAWMIND_EMBED_MODEL=sentence-transformers/all-MiniLM-L6-v2` if you want to skip the MLX attempt.

**Ingest is slow.** Increase `concurrency` in your ingest call, or shrink the workspace by adding more exclude globs.

**LanceDB schema mismatch.** Delete `data/lancedb` and reingest. The dim must match `CLAWMIND_EMBED_DIM`.

**Chat returns "all LLM providers failed".** Confirm `hermes-agent` is running on `:8642`, or set `CLAWMIND_LLM_FALLBACK_URL` to a reachable OpenAI-compatible endpoint.
