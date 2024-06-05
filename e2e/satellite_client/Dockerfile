FROM node:18-alpine AS workspace

RUN apk update && apk add git
RUN corepack enable && corepack prepare pnpm@8.15.3 --activate

RUN mkdir /app
WORKDIR /app

COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY pnpm-workspace.yaml ./

# E2E Client deps install + build
COPY clients/typescript ./clients/typescript
COPY common ./common
COPY generator ./generator
COPY e2e/satellite_client/package.json  ./e2e/satellite_client/
RUN pnpm install -r --offline --filter @internal/satellite-client^...
RUN pnpm run -r --filter @internal/satellite-client^... build
RUN pnpm install --offline --filter @internal/satellite-client

# E2E Client build
COPY e2e/satellite_client/src  ./e2e/satellite_client/src
COPY e2e/satellite_client/tsconfig.json  ./e2e/satellite_client
RUN pnpm run --filter @internal/satellite-client build

# Deploy an isolated node_modules + src in which the E2E Client will be run
# Otherwise the pnpm node_modules links won't work in the runner Docker stage
RUN pnpm --filter @internal/satellite-client --prod deploy output

FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=workspace /app/output .

ENTRYPOINT ["node"]

