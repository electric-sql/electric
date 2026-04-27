# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# This Dockerfile expects the repository root as the build context so pnpm can
# install the workspace dependencies needed by @electric-ax/agents-server.
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Copy only dependency manifests first so source-only changes do not invalidate
# the pnpm install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/typescript-client/package.json ./packages/typescript-client/package.json
COPY packages/agents-runtime/package.json ./packages/agents-runtime/package.json
COPY packages/agents/package.json ./packages/agents/package.json
COPY packages/agents-server-conformance-tests/package.json ./packages/agents-server-conformance-tests/package.json
COPY packages/agents-server-ui/package.json ./packages/agents-server-ui/package.json
COPY packages/agents-server/package.json ./packages/agents-server/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --filter @electric-ax/agents-server... --filter @electric-sql/client --frozen-lockfile

COPY tsconfig.base.json tsconfig.build.json ./
COPY packages/typescript-client ./packages/typescript-client
RUN pnpm --filter @electric-sql/client build

COPY packages/agents-runtime ./packages/agents-runtime
RUN pnpm --filter @electric-ax/agents-runtime build

COPY packages/agents-server-ui ./packages/agents-server-ui
RUN pnpm --filter @electric-ax/agents-server-ui build

COPY packages/agents-server ./packages/agents-server
RUN pnpm --filter @electric-ax/agents-server build

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm deploy --legacy --filter @electric-ax/agents-server --prod /prod/agents-server \
  && mkdir -p /prod/agents-server-ui \
  && cp -R packages/agents-server-ui/dist /prod/agents-server-ui/dist \
  && cp -R packages/agents-server/drizzle /prod/agents-server/drizzle

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

COPY --from=build /prod /prod

WORKDIR /prod/agents-server

EXPOSE 4437

ENTRYPOINT ["node", "dist/entrypoint.js"]
