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

Electric writes [shape logs](/docs/api/http#shape-log) to disk.

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

Electric creates a durable replication slot in Postgres to prevent data loss during downtime. 

During normal execution, Electric consumes the WAL file and keeps advancing `confirmed_flush_lsn`. However, if Electric is disconnected, the WAL file accumulates the changes that haven't be delivered to Electric.

##### Solution &mdash; Remove replication slot after Electric is gone

If you're stopping Electric for the weekend, we recommend removing the ```electric_slot_default``` replication slot to prevent unbounded WAL growth. When Electric restarts, if it doesn't find the replication slot at resume point, it will recreate the replication slot and drop all shape logs.

You can also control the size of the WAL with [```wal_keep_size```](https://www.postgresql.org/docs/current/runtime-config-replication.html#GUC-WAL-KEEP-SIZE). On restart, Electric will detect if the WAL is past the resume point too.

## IPv6 support

If Electric or Postgres are running behind a IPv6 network, you might have perform additional configurations on your network.

### Postgres running behind Ipv6 network

In order for Electric to connect to Postgres over IPv6, you need to set [`ELECTRIC_DATABASE_USE_IPV6`](/docs/api/config#database-use-ipv6) to `true`.

#### Local development
If you're running Electric on your own computer, check if you have IPv6 support by opening [test-ipv6.com](https://test-ipv6.com). If you see "No IPv6 address detected" on that page, consider `ssh`ing into another machine or using a VPN service that works with IPv6 networks.

When running Electric in a Docker container, there's an additional hurdle in that Docker does not enable IPv6 out-of-the-box. Follow the [official guide](https://docs.docker.com/config/daemon/ipv6/#use-ipv6-for-the-default-bridge-network) to configure your Docker daemon for IPv6.

#### Cloud

If you're running Electric in a Cloud provider, you need to ensure that your VPC is configured with IPv6 support. Check your Cloud provider documentation to learn how to set it up.

### Electric running behind Ipv6 network

By default Electric only binds to IPv4 addresses. You need to set [`ELECTRIC_LISTEN_ON_IPV6`](/docs/api/config#electric-use-ipv6) to `true` to bind to bind to IPv6 addresses as well.