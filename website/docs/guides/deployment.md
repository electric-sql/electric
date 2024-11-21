---
title: Deployment - Guide
description: >-
  How to deploy the Electric sync engine.
outline: [2, 3]
---

<img src="/img/icons/deploy.png" class="product-icon"
    style="width: 72px"
/>

# Deployment

How to deploy the [Electric sync engine](/product/electric), with links to integration docs for specific platforms like [Supabase](/docs/integrations/supabase), [Neon](/docs/integrations/neon), [Render](/docs/integrations/render) and [AWS](/docs/integrations/aws).

> [!TIP] Electric Cloud &ndash; the simplest way to use Electric
> The simplest way to use Electric is via the [Electric Cloud](/product/cloud), which is a simple, scalable, <span class="no-wrap">low-cost</span>, managed Electric hosting service.
>
>   <p class="action cloud-cta">
>     <a href="/product/cloud" class="VPButton small brand vspace">
>       <span class="vpi-electric-icon"></span> View Cloud</a>
>   </p>

## The ingredients of a successful deployment

An Electric deployment has three main components. Your Postgres database, the Electric sync service and your app.

Electric connects to your Postgres using a `DATABASE_URL`. Your app connects to Electric [over HTTP](/docs/api/http), usually using a [Client library](/docs/api/clients/typescript).

<figure>
  <a href="/img/deployment/components.jpg">
    <img src="/img/deployment/components.png" class="hidden-sm"
        alt="Illustration of the main components of a successfull deployment"
    />
    <img src="/img/deployment/components.sm.png" class="block-sm"
        style="max-width: 360px"
        alt="Illustration of the main components of a successfull deployment"
    />
  </a>
</figure>

As a result, there are three ingredients to a successful Electric deployment:

1. you need to be [running a Postgres database](#_1-running-postgres)
2. you need to [run and connect the Electric sync service](#_2-running-electric)
3. you need your app/client to [connect to Electric over HTTP](#_3-connecting-your-app)

### Proxying requests to Electric

You also often want to proxy requests to Electric through your API, or other proxy. For example, to implement [auth](./auth) and/or [caching](/docs/api/http#caching). In these cases, you'll also need to deploy your API and/or proxy layer in front of Electric.

Note also that, when running Electric behind a CDN, you may want your proxy in front of the CDN. This is where primitives like [edge functions](/docs/integrations/supabase#sync-into-edge-function) and [edge workers](/docs/integrations/cloudflare#workers) can be very useful.

## 1. Running Postgres

You can use ***any standard Postgres***, version 14 and above.

This includes Postgres you host yourself, or Postgres hosted by managed database hosting providers, including:

- [Supabase](/docs/integrations/supabase)
- [Neon](/docs/integrations/neon)
- [AWS (RDS and Aurora)](/docs/integrations/aws)
- [GCP (Cloud SQL and Alloy)](/docs/integrations/gcp)
- [Digital Ocean](/docs/integrations/digital-ocean)
- [Crunchy](/docs/integrations/crunchy)

Postgres must have [logical replication](https://www.postgresql.org/docs/current/logical-replication-config.html) enabled. You also need to connect as a database role that has the [`REPLICATION`](https://www.postgresql.org/docs/current/logical-replication-security.html) attribute.

### Data model compatibility

Electric is compatible with ***any Postgres data model***.

Electric will work as a drop on to any existing data model. There are no limitations on the database features, data types or extensions you can use.

### Connecting to Postgres

You connect to Postgres using a [`DATABASE_URL`](/docs/api/config#database-url) env var. This connection string contains your user credentials and an `sslmode` parameter.

You usually want to connect directly to Postgres and not via a connection pool. This is because Electric uses logical replication and most connection poolers don't support it. (pgBouncer does support logical replication, [as of version 1.23](https://www.pgbouncer.org/changelog.html#pgbouncer-123x) so this may change in future).

> [!Tip] Troubleshooting common errors
> If you get a TCP connection error saying `non-existing domain - :nxdomain` or `network is unreachable - :enetunreach` then you may need to connect using IPv6. You can enable this by setting [`ELECTRIC_DATABASE_USE_IPV6=true`](/docs/api/config#database-use-ipv6).
>
> If you get a TCP connection `timeout` error then make sure you're connecting directly to Postgres and not via a connection pool. For example, when using [Supabase](/docs/integrations/supabase) you need to untick their "Use connection pooling" option on the database settings page.
>
> If you're using IPv6 with Docker, then assuming the machine you're running Electric on has IPv6 connectivity, you may also need to enable IPv6 for the Docker daemon. You can do this by [defining an IPv6-capable network](https://docs.docker.com/engine/daemon/ipv6/#create-an-ipv6-network)) in your Compose file and then adding the `networks` key to the Electric service definition.

### Database resources

Electric creates a logical replication [publication](https://www.postgresql.org/docs/current/logical-replication-publication.html) and [replication slot](https://www.postgresql.org/docs/current/logical-replication-subscription.html#LOGICAL-REPLICATION-SUBSCRIPTION-SLOT) inside Postgres. These are called `electric_publication_default` and `electric_slot_default` by default. You can configure the name suffix using the [`ELECTRIC_REPLICATION_STREAM_ID`](/docs/api/config#replication-stream-id) env var.

When running, Electric also keeps a pool of active database connections open. The size of this pool defaults to `20` and can be configured using [`ELECTRIC_DB_POOL_SIZE`](/docs/api/config#electric-db-pool-size).

> [!Tip] Cleaning up resources
> If you decide to stop using Electric with a given Postgres database or switch to a different database but keep the old one around, make sure to clean up both the publication and the replication slot.
>
> See this [troubleshooting advice](./troubleshooting#wal-growth-mdash-why-is-my-postgres-database-storage-filling-up) for details.

## 2. Running Electric

The [Electric sync engine](/product/electric) is an Elixir web service, packaged using Docker.

You can deploy it anywhere you can run a container with a filesystem and exposed HTTP port. This includes cloud and application hosting platforms like:

- [AWS](/docs/integrations/aws)
- [GCP](/docs/integrations/gcp)
- [Digital Ocean](/docs/integrations/digital-ocean)
- [Fly.io](/docs/integrations/fly)
- [Render](/docs/integrations/render)

### Docker container

Images are deployed to Docker Hub at [electricsql/electric](https://hub.docker.com/r/electricsql/electric).

### Optimizing for disk

Electric caches [Shape logs](/docs/api/http#shape-log) and metadata on the filesystem. Your Electric host must provide a persistent filesystem. Ideally this should be large, fast and locally mounted, such as a NVMe SSD. If you're configuring a machine and you want to optimise it for Electric, the factors to optimise for, in order of important, are:

1. disk speed &mdash; low latency, high throughout reads and writes
2. memory
3. CPU

For example, on AWS, [Storage Optimized](https://aws.amazon.com/ec2/instance-types/#Storage_Optimized) instances such as the `i3en.large`, or on Hetzner the [SX-line](https://www.hetzner.com/dedicated-rootserver/matrix-sx/) of dedicated servers would both be great choices.

### Configuring storage

The path to Electric's persistent storage can be configured via the [`ELECTRIC_STORAGE_DIR`](/docs/api/config#electric-storage-dir) environment variable, e.g. `ELECTRIC_STORAGE_DIR=/var/lib/electric/persistent`. Electric will create the directory at that path if it doesn't exist yet. However, you need to make sure that the OS user that Electric is running as has the necessary permissions in the parent directory.

The file system location configured via `ELECTRIC_STORAGE_DIR` and the data Electric stores there must survive sync service's restarts. For example, when using Kubernetes, you'll want to create a persistent volume and attach it to your Electric deployment.

> [!Tip] Clear one, clear the other
> The persistent state that Electric maintains in Postgres (via the logical replication publication and replication slot) **must** stay in sync with the shape data cached on disk by Electric.
>
> If you change the value of `ELECTRIC_STORAGE_DIR` or switch to a different `DATABASE_URL` at any point, you **must** clean up the other location by hand, whether it's removing a directory tree on disk or dropping the replication slot and publication in Postgres.

> [!Tip] How much storage space?
> Electric trades storage for low memory use and fast sync. How much storage you need is highly application dependent. We encourage you to test with your own workload.
>
> We plan to implement [compaction](https://github.com/electric-sql/electric/issues/1582) and other features to limit and optimise storage use, such as [garbage collecting LRU shapes](https://github.com/electric-sql/electric/issues/1529).

### HTTP port

Electric provides an HTTP API exposed on a configurable [`ELECTRIC_PORT`](/docs/api/config#electric-port). You should make sure this is exposed to the Internet.

### Caching proxy

Electric is designed to run behind a caching proxy, such as [Nginx](https://nginx.org/en), [Caddy](https://caddyserver.com), [Varnish](https://varnish-cache.org) or a CDN like [Cloudflare](https://www.cloudflare.com/en-gb/application-services/products/cdn) or [Fastly](https://www.fastly.com/products/cdn). You don't *have* to run a proxy in front of Electric but you will benefit from radically better performance if you do.

See the [Caching section](/docs/api/http#caching) of the HTTP API docs for more information.

## 3. Connecting your app

You can then connect your app to Electric [over HTTP](/docs/api/http). Typically you use a [Client library](/docs/api/clients/typescript) and configure the URL in the constructor, e.g.:

```ts
const stream = new ShapeStream({
  url: `https://your-electric-service.example.com/v1/shape`,
  params: {
    table: `foo`
  }
})
const shape = new Shape(stream)
```

You can connect to Electric from any language/environment that speaks HTTP. See the [HTTP API](/docs/api/http) and [Client docs](/docs/api/clients/typescript) for more information.
