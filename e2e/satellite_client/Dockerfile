FROM node:18-alpine AS workspace

RUN apk update && apk add git
RUN corepack enable && corepack prepare pnpm@8.6.0 --activate

RUN mkdir /app
WORKDIR /app

COPY pnpm-lock.yaml ./
RUN pnpm fetch


COPY pnpm-workspace.yaml ./
COPY clients/typescript ./clients/typescript
COPY generator ./generator
COPY e2e/satellite_client ./e2e/satellite_client

RUN pnpm install -r --filter satellite_client^...
RUN pnpm run -r --filter satellite_client^... build
RUN pnpm install -r --filter satellite_client
RUN ls -lA e2e/satellite_client/node_modules/prisma-generator-electric/dist
RUN pnpm run -r --filter satellite_client build

RUN pnpm --filter satellite_client --prod deploy output

FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=workspace /app/output .

ENTRYPOINT ["node"]

