FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
WORKDIR /repo
RUN pnpm --filter @clawmind/web build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo /app
EXPOSE 7412
CMD ["pnpm", "--filter", "@clawmind/web", "start"]
