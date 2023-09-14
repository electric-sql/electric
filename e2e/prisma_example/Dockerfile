FROM node:18-alpine AS workspace

RUN corepack enable && corepack prepare pnpm@8.6.0 --activate
RUN mkdir /app
WORKDIR /app

COPY ./src .
RUN pnpm fetch

RUN pnpm install

ENTRYPOINT ["npx"]

