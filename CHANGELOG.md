# Changelog

## Unreleased
- Outbound webhook SSRF guard. Reject loopback, RFC1918, link-local, CGNAT, multicast, reserved, and cloud metadata targets at registration and re-resolve DNS on every delivery attempt so DNS rebinding cannot bypass the check. Rejections are written to the audit log as `webhook.blocked`.

## 0.1.0
- First public release.
- Hybrid retrieval, streaming chat with citations, CLI, web UI, REST API.
- Apple MLX embedding sidecar with sentence-transformers fallback.
- LanceDB for vectors, BM25 in-memory index for sparse retrieval.
- Docker, Helm, and Terraform skeletons.
