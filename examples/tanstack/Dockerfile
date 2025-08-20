FROM node:lts-alpine AS base

# Stage 1: Install dependencies
FROM base AS deps
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-*.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.build.json ./
COPY patches/ ./patches/
COPY packages/typescript-client packages/typescript-client/
COPY packages/react-hooks packages/react-hooks/
COPY examples/tanstack examples/tanstack/

# Install dependencies
RUN pnpm install --frozen-lockfile
RUN pnpm run -r build 

# Make production image
FROM base
WORKDIR /app/examples/tanstack

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ../../node_modules
COPY --from=deps /app/examples/tanstack/node_modules ./node_modules
COPY --from=deps /app/examples/tanstack/dist ./dist
COPY --from=deps /app/examples/tanstack/public ./public
COPY --from=deps /app/examples/tanstack/package.json ./
COPY --from=deps /app/examples/tanstack/src/server ./src/server
COPY --from=deps /app/packages/typescript-client ../../packages/typescript-client
COPY --from=deps /app/packages/react-hooks ../../packages/react-hooks

CMD ["npm", "start"]
#CMD ["tail", "-f", "/dev/null"]