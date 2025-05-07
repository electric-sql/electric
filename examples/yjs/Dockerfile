FROM node:lts-alpine AS base

# Stage 1: Install dependencies
FROM base AS deps
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-*.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.build.json ./
COPY packages/typescript-client packages/typescript-client/
COPY packages/react-hooks packages/react-hooks/
COPY examples/yjs examples/yjs/

# Install dependencies
RUN pnpm install --frozen-lockfile
RUN pnpm run build:server 


# Need to make production image more clean
FROM base AS prod
WORKDIR /app

ENV NODE_ENV=production
COPY --from=deps /app/ ./

WORKDIR /app/examples/yjs/

EXPOSE 3000
CMD ["pnpm", "run", "start:server"]