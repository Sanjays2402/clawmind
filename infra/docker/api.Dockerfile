# Multi-stage build for the ClawMind API
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
WORKDIR /repo
RUN pnpm --filter @clawmind/api... build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -g 10001 cm && adduser -D -u 10001 -G cm cm
COPY --from=build /repo /app
USER cm
EXPOSE 7410
CMD ["node", "apps/api/dist/server.js"]
