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
COPY examples/remix examples/remix/

# Install dependencies
RUN pnpm install --frozen-lockfile
RUN pnpm run -r build 

# Make production image
FROM base
WORKDIR /app/examples/remix

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ../../node_modules
COPY --from=deps /app/examples/remix/node_modules ./node_modules
COPY --from=deps /app/examples/remix/build ./build
COPY --from=deps /app/examples/remix/public ./public
COPY --from=deps /app/examples/remix/package.json ./

CMD ["npm", "start"]