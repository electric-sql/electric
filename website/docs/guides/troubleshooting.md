---
title: Troubleshooting - Guide
description: >-
  Tips and FAQs on how to run Electric successfully.
outline: [2, 3]
---

<img src="/img/icons/troubleshoot.svg" class="product-icon"
    style="width: 72px"
/>

# Troubleshooting

Tips and answers to FAQs about how to run Electric successfully.

## Local development

### Slow shapes &mdash; why are my shapes slow in the browser in local development?

Sometimes people encounter a mysterious slow-down with Electric in local development, when your web app is subscribed to 6 or more shapes. This slow-down is caused by a limitation of the legacy version of HTTP, 1.1.

With HTTP/1.1, browsers only allow 6 simultaneous requests to a specific backend. This is because each HTTP/1.1 request uses its own expensive TCP connection. As shapes are loaded over HTTP, this means only 6 shapes can be getting updates with HTTP/1.1 due to this browser restriction. All other requests pause until there's an opening.

HTTP/2, introduced in 2015, fixes this problem by _multiplexing_ each request to a server over the same TCP connection. This allows essentially unlimited connections. HTTP/2 is standard across the vast majority of hosts now. Unfortunately it's not yet standard in local dev environments.

##### Solution &mdash; subdomain sharding

As of version 1.0.13, the Electric TypeScript client automatically solves this problem using subdomain sharding. This assigns each shape a unique subdomain (e.g., `a7f2c.localhost`). This bypasses the browser's HTTP/1.1 connection limits.

Subdomain sharding is enabled by default for `localhost` and `*.localhost` URLs, so if you're running Electric (or your local API / proxy in front of it) on localhost, shapes will now be fast out of the box with no additional setup required.

If you're using a custom domain in development, you can explicitly enable subdomain sharding:

```ts
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: 'http://example-dev-domain:3000/v1/shape',
  shardSubdomain: 'always' // Enable subdomain sharding for all hosts
})
```

If you're using an older version of `@electric-sql/client` (before 1.0.13) then you should upgrade to get subdomain sharding.

If you're using a custom client or otherwise need a different solution, you can run a reverse proxy, such as [Caddy](https://caddyserver.com) that supports HTTP/2. The Vite development server also supports running in HTTP/2 mode.

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

### Unexpected 409 &mdash; why is my shape handle invalid?

If, when you request a shape, you get an unexpected `409` status despite the shape existing (for example, straight after you've created it), e.g.:

```
url: http://localhost:3000/v1/shape?table=projects&offset=-1
sec: 0.086570622 seconds
status: 200

url: http://localhost:3000/v1/shape?table=projects&offset=0_0&handle=17612588-1732280609822
sec: 1.153542301 seconds
status: 409
conflict reading Location

url: http://localhost:3000/v1/shape?table=projects&offset=0_0&handle=51930383-1732543076951
sec: 0.003023737 seconds
status: 200
```

This indicates that your client library or proxy layer is caching requests to Electric and responding to them without actually hitting Electric for the correct response. For example, when running unit tests your library may be maintaining an unexpected global HTTP cache.

##### Solution &mdash; clear your cache

The problem will resolve itself as client/proxy caches empty. You can force this by clearing your client or proxy cache. See https://electric-sql.com/docs/api/http#control-messages for context on 409 messages.

## Production

### WAL growth &mdash; why is my Postgres database storage filling up?

Electric creates a durable replication slot in Postgres to prevent data loss during downtime. 

During normal execution, Electric consumes the WAL file and keeps advancing `confirmed_flush_lsn`. However, if Electric is disconnected, the WAL file accumulates the changes that haven't been delivered to Electric.

##### Solution &mdash; Remove replication slot after Electric is gone

If you're stopping Electric for the weekend, we recommend removing the ```electric_slot_default``` replication slot to prevent unbounded WAL growth. When Electric restarts, if it doesn't find the replication slot at resume point, it will recreate the replication slot and drop all shape logs.

You can also control the size of the WAL with [```wal_keep_size```](https://www.postgresql.org/docs/current/runtime-config-replication.html#GUC-WAL-KEEP-SIZE). On restart, Electric will detect if the WAL is past the resume point too.

## IPv6 support

If Electric or Postgres are running behind an IPv6 network, you might have to perform additional configurations on your network.

### Postgres running behind IPv6 network

In order for Electric to connect to Postgres over IPv6, you need to set [`ELECTRIC_DATABASE_USE_IPV6`](/docs/api/config#database-use-ipv6) to `true`.

#### Local development
If you're running Electric on your own computer, check if you have IPv6 support by opening [test-ipv6.com](https://test-ipv6.com). If you see "No IPv6 address detected" on that page, consider `ssh`ing into another machine or using a VPN service that works with IPv6 networks.

When running Electric in a Docker container, there's an additional hurdle in that Docker does not enable IPv6 out-of-the-box. Follow the [official guide](https://docs.docker.com/config/daemon/ipv6/#use-ipv6-for-the-default-bridge-network) to configure your Docker daemon for IPv6.

#### Cloud

If you're running Electric in a Cloud provider, you need to ensure that your VPC is configured with IPv6 support. Check your Cloud provider documentation to learn how to set it up.

### Electric running behind IPv6 network

By default Electric only binds to IPv4 addresses. You need to set [`ELECTRIC_LISTEN_ON_IPV6`](/docs/api/config#electric-use-ipv6) to `true` to bind to bind to IPv6 addresses as well.

### Missing headers &mdash; why is the client complaining about missing headers?

When Electric responds to shape requests it includes headers that are required by the client to follow the shape log.
It is common to run Electric behind a proxy to authenticate users and authorise shape requests.
However, the proxy might not keep the response headers in which case the client may complain about missing headers.

##### Solution &mdash; configure proxy to keep headers

Verify the proxy configuration and make sure it doesn't remove any of the `electric-...` headers.
