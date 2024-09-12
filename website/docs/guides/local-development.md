---
title: Local Development - Guide
description: >-
  How to develop locally with Electric.
outline: [2, 3]
---

# Local development

You need to have a Postgres database and to run Electric in front of it.

## How to develop locally with Electric

Electric is an [Elixir](https://elixir-lang.org) web application published as a Docker image at [electricsql/electric](https://hub.docker.com/r/electricsql/electric). It connects to Postgres via a `DATABASE_URL`.

### Postgres requirements

You can use any Postgres (new or existing) that has [logical replication enabled](https://www.postgresql.org/docs/current/logical-replication-config.html). You also need to make sure you connect as a database user that has the [`REPLICATION` privilege](https://www.postgresql.org/docs/current/logical-replication-security.html).

### Using Docker

You can run a fresh Postgres and Electric connected together using [Docker Compose](https://docs.docker.com/compose) with this [`docker-compose.yaml`](https://github.com/electric-sql/electric/blob/main/website/public/docker-compose.yaml):

<<< @/public/docker-compose.yaml

For example you can run this using:

```sh
curl -O https://electric-sql.com/docker-compose.yaml
docker compose up
```

Alternatively, you can run the Electric sync service on its own and connect it to an existing Postgres database, e.g.:

```sh
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -p 3000:3000 \
    -t \
    electricsql/electric:latest
```

### Using Elixir

Clone the Electric repo:

```sh
git clone https://github.com/electric-sql/electric.git
cd electric
```

Install the system dependencies with [asdf](https://asdf-vm.com). Versions are defined in [.tool-versions](https://github.com/electric-sql/electric/blob/main/.tool-versions):

```sh
asdf plugin-add elixir
asdf plugin-add erlang
asdf plugin-add nodejs
asdf plugin-add pnpm
asdf install
```

Install the [packages/sync-service](https://github.com/electric-sql/electric/tree/main/packages/sync-service) dependencies using [Mix](https://hexdocs.pm/mix/1.12/Mix.html).:

```sh
cd packages/sync-service
mix deps.get
```

Run the development server:

```sh
mix run --no-halt
```

This will try to connect to Postgres using the `DATABASE_URL` configured in [packages/sync-service/.env.dev](https://github.com/electric-sql/electric/blob/main/packages/sync-service/.env.dev), which defaults to:

<<< @/../packages/sync-service/.env.dev

You can edit this file to change the configuration. To run the tests, you'll need a Postgres running that matches the `:test` env config in [config/runtime.exs](https://github.com/electric-sql/electric/blob/main/packages/sync-service/config/runtime.exs) and then:

```sh
mix test
```

## Troubleshooting

### Slow shapes in browser

Sometimes people encounter a mysterious slow-down with Electric in local development, when your web app is subscribed to 6 or more shapes. This slow-down is caused by a limitation of the legacy version of HTTP, 1.1.

With HTTP/1.1, browsers only allow 6 simultaneous requests to a specific backend. This is because each HTTP/1.1 request uses its own expensive TCP connection. As shapes are loaded over HTTP, this means only 6 shapes can be getting updates with HTTP/1.1 due to this browser restriction. All other requests pause until there's an opening.

Luckily, HTTP/2, introduced in 2015, fixes this problem by _multiplexing_ each request to a server over the same TCP connection. This allows essentially unlimited connections. HTTP/2 is standard across the vast majority of hosts now. Unfortunately it's not yet standard in local dev environments.

##### Solution &mdash; run Caddy

To fix this, you can setup a local reverse-proxy using the popular [Caddy server](https://caddyserver.com). Caddy automatically sets up HTTP/2 and proxies requests to Electric, getting around the 6 requests limitation with HTTP/1.1 in the browser.

This command runs Caddy so it's listening on port 3001 and proxying shape requests to Electric which listens on port 3000. If you're loading shapes through your API or framework dev server, replace `3000` with the port that your API or dev server is listening on.

```sh
npx @radically-straightforward/caddy run \
    --config - \
    --adapter caddyfile \
    <<EOF
:3001 {
  reverse_proxy localhost:3000
  encode {
    gzip
  }
}
EOF
```

Now change your shape URLs to use port `3001` instead of port 3000 and everything will run much faster 🚀

### Resetting server state

Electric creates resources, including a logical replication publication and replication slots in your Postgres database. Electric also stores [shape logs](/docs/api/http#shape-log) to disk. Sometimes in development you may want to clear this state.

##### Solution &mdash; use Docker

If you're running using Docker Compose, the simplest solution is to stop the Postgres and Electric services running, using `--volumes` to also destroy the storage volumes mounted to the services:

```sh
docker compose down --volumes
```
### WAL filling up

Electric creates a logical replication publication in your Postgres database and adds tables dynamically (as you request shapes) to this publication. If you don't consume this publication, the WAL can fill up and your Postgres database can run out of space.

The most common way this can happen is that you create an Electric publication and then stop running Electric.

##### Solution &mdash; run Electric

The simplest way to avoid this is to make sure you're running the Electric sync service against Postgres. This will consume the publication and allow the WAL to be released.
