# Development

```bash
pnpm install
pnpm dev
pnpm test
pnpm typecheck
```

The repo uses Turborepo. `pnpm --filter @clawmind/<pkg>` scopes a command.

Tests:

- `vitest` for retrieval, ranking, chunkers, and config.
- `playwright` skeleton in `apps/web/e2e` for the web UI.
