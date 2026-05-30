# Production multi-stage build for the ClawMind API.
#
# Stages:
#   1. base    - pnpm-enabled node image used by deps/build
#   2. deps    - full workspace install with dev deps for building
#   3. build   - compiles @clawmind/api to dist/ via tsc
#   4. prod    - re-installs production-only deps for the api filter
#   5. deploy  - `pnpm deploy` produces a self-contained app folder with
#                workspace packages flattened into node_modules
#   6. runtime - distroless-friendly alpine image carrying ONLY the compiled
#                output, the pruned node_modules, and the package.json.
#                No source, no dev deps, no pnpm, no build toolchain.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @clawmind/api... build

# Re-resolve workspace deps for the api with prod-only flags so devDependencies
# (typescript, tsx, vitest, @types/*) do not leak into the deploy bundle.
FROM build AS prod
RUN pnpm --filter @clawmind/api... install --prod --frozen-lockfile --ignore-scripts

# pnpm deploy flattens the api workspace + its workspace deps into one folder
# that contains everything node needs at runtime and nothing else.
FROM prod AS deploy
RUN pnpm --filter @clawmind/api deploy --prod --legacy /out

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps" \
    CLAWMIND_API_HOST=0.0.0.0 \
    CLAWMIND_API_PORT=7410
WORKDIR /app
RUN addgroup -g 10001 cm \
    && adduser -D -u 10001 -G cm -h /app cm \
    && apk add --no-cache tini wget \
    && rm -rf /var/cache/apk/*
COPY --from=deploy --chown=cm:cm /out/package.json ./package.json
COPY --from=deploy --chown=cm:cm /out/node_modules ./node_modules
COPY --from=deploy --chown=cm:cm /out/dist ./dist
USER cm
EXPOSE 7410
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:7410/live >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
