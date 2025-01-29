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
COPY examples/todo-app/ examples/todo-app

# Install dependencies
RUN pnpm install --frozen-lockfile
RUN pnpm run -r build 


# Need to make production image more clean
FROM base AS prod
WORKDIR /app

ENV NODE_ENV=production
COPY --from=deps /app/ ./

WORKDIR /app/examples/todo-app

EXPOSE 3010
ENTRYPOINT ["node", "server.js"]