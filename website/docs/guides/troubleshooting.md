---
title: Troubleshooting - Guide
description: >-
  Tips and FAQs on how to run Electric successfully.
outline: [2, 3]
---

# Troubleshooting

Tips and answers to FAQs about how to run Electric successfully.

## Local development

### Slow shapes &mdash; why are my shapes slow in the browser in local development?

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

### Shape logs &mdash; how do I clear the server state?

Electric stores [shape logs](/docs/api/http#shape-log) to disk.

During development, you may want to clear this state. However, just restarting Electric doesn't clear the underlying storage, which can lead to unexpected behaviour.

##### Solution &mdash; clear shape logs

You can remove [```STORAGE_DIR```](https://electric-sql.com/docs/api/config#storage-dir) to delete all shape logs. This will ensure that following shape requests will be re-synced from scratch.

###### Using docker

If you're running using Docker Compose, the simplest solution is to bring the Postgres and Electric services down, using the `--volumes` flag to also clear their mounted storage volumes:

```sh
docker compose down --volumes
```

You can then bring a fresh backend up from scratch:

```sh
docker compose up
```

## Production

### WAL growth &mdash; why is my Postgres database storage filling up?

Electric creates a durable replication slot in Postgres to prevent data loss during downtime. This means that Postgres WAL will grow while Electric is not consuming the publication.

##### Solution &mdash; Remove replication slot after Electric is gone

If you're stopping Electric for the weekend, we recommend removing the ```electric_slot_default``` replication slot to prevent unbounded WAL growth. When Electric restarts, if it doesn't find the replication slot at resume point, it will recreate the replication slot and drop all shape logs.

You can also control the size of the WAL with [```wal_keep_size```](https://www.postgresql.org/docs/current/runtime-config-replication.html#GUC-WAL-KEEP-SIZE). On restart, Electric will detect if the WAL is past the resume point too.