FROM node:18-alpine AS workspace

RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
RUN mkdir /app
WORKDIR /app

COPY ./src .
COPY ./migrations-1 ./migrations-1

RUN pnpm fetch

RUN pnpm install

ENTRYPOINT ["npx"]

