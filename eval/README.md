# Eval

A small golden set of questions and the topics each answer must mention. Useful for sanity checking retrieval and rerank changes.

Run with:

```bash
pnpm tsx eval/run.ts
```

The script reads `eval/questions/*.md`, runs them through the retrieval pipeline, and writes a JSON report to `eval/reports/`.
