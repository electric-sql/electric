---
title: Troubleshooting - Guide
description: >-
  Tips and FAQs on how to run Electric successfully.
outline: [2, 3]
---

# Troubleshooting

Tips and answers to FAQs about how to run Electric successfully.

## Local development

### 1. Slow shapes &mdash; why are my shapes slow in the browser in local development?

Sometimes people encounter a mysterious slow-down with Electric in local development, when your web app is subscribed to 6 or more shapes. This slow-down is caused by a limitation of the legacy version of HTTP, 1.1.

With HTTP/1.1, browsers only allow 6 simultaneous requests to a specific backend. This is because each HTTP/1.1 request uses its own expensive TCP connection. As shapes are loaded over HTTP, this means only 6 shapes can be getting updates with HTTP/1.1 due to this browser restriction. All other requests pause until there's an opening.

Luckily, HTTP/2, introduced in 2015, fixes this problem by _multiplexing_ each request to a server over the same TCP connection. This allows essentially unlimited connections. HTTP/2 is standard across the vast majority of hosts now. Unfortunately it's not yet standard in local dev environments.

#### Solution &mdash; run Caddy

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

### 2. Stale data &mdash; how do I clear the server state?

Electric creates resources, including a logical replication publication and replication slots in your Postgres database. Electric also stores [shape logs](/docs/api/http#shape-log) to disk. Sometimes in development you may want to clear this state.

#### Solution &mdash; use Docker

If you're running using Docker Compose, the simplest solution is to stop the Postgres and Electric services running, using `--volumes` to also destroy the storage volumes mounted to the services:

```sh
docker compose down --volumes
```

## Production deployment

### 3. WAL growth &mdash; why is my Postgres database storage filling up?

Electric creates a logical replication publication in your Postgres database and adds tables dynamically (as you request shapes) to this publication. If you don't consume this publication, the WAL can fill up and your Postgres database can run out of storage space.

The most common way this can happen is that you create an Electric publication and then stop running Electric.

#### Solution &mdash; run Electric

The simplest way to avoid this is to make sure you're running the Electric sync service against Postgres. This will consume the publication and allow the WAL to be released.
