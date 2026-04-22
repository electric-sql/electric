FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
ENV CI=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# This Dockerfile expects the repository root as the build context so pnpm can
# install the workspace dependencies needed by @electric-ax/agent-server.
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY . .

RUN pnpm install --filter @electric-ax/agent-server... --frozen-lockfile
RUN pnpm --filter @electric-ax/agent-server... build

WORKDIR /app/packages/agent-server

EXPOSE 4437

ENTRYPOINT ["node", "dist/entrypoint.js"]
