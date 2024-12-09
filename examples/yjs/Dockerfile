FROM node:lts-alpine AS base

# Stage 1: Install dependencies
FROM base AS deps
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-*.yaml ./
COPY package.json ./
COPY tsconfig.build.json ./
COPY packages/typescript-client packages/typescript-client/
COPY packages/react-hooks packages/react-hooks/
COPY examples/yjs-provider/ examples/yjs-provider/

# Install dependencies
RUN pnpm install --frozen-lockfile
RUN pnpm run -r build 


# Need to make production image more clean
FROM node:lts-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production
COPY --from=deps /app/ ./

WORKDIR /app/examples/yjs-provider/

EXPOSE 3000
CMD ["npm", "run", "start"]