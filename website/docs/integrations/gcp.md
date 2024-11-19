---
outline: deep
title: Google Cloud Platform (GCP) - Integrations
description: >-
  How to deploy Electric on Google Cloud Platform (GCP).
image: /img/integrations/electric-gcp.jpg
---

<img src="/img/integrations/gcp.svg" class="product-icon" />

# Google Cloud Platform (GCP)

GCP is a cloud infrastructure platform.

## Electric and GCP

You can use GCP to deploy any or all components of the Electric stack:

- [deploy a Postgres database](#deploy-postgres)
- [an Electric sync service](#deploy-electric)
- [your client application](#deploy-your-app)

If you already run Postgres in GCP, then it's a great idea to also deploy Electric within the same network.

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Postgres

GCP provides Postgres hosting via [Cloud SQL](https://cloud.google.com/sql/docs/postgres/) or [AlloyDB](https://cloud.google.com/alloydb). Electric works with either. You need to configure them to enable logical replication and connect with the right user.

#### Cloud SQL

The default `wal_level` is `replica`. Change it to `logical` by [setting the `cloudsql.logical_decoding` flag to `on`](https://cloud.google.com/sql/docs/postgres/replication/configure-logical-replication#configure-your-postgresql-instance).

> [!Tip] Customise your instance on setup
> You can set flags in the "Flags" panel of the "Customise your instance" section of the [create database page](https://console.cloud.google.com/sql/instances/create;engine=PostgreSQL) in the console, when setting up your database.

Be careful to connect using the "Outgoing IP address", not the "Public IP address". You will also need to create a new database user with `REPLICATION`. Log in using the default `postgres` user and then run something like this, changing the username and database name as necessary:

```sql
CREATE ROLE electric WITH REPLICATION LOGIN PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE "postgres" to electric;
```

You can then connect to Postgres from Electric as that user, which you can verify using e.g.:

```shell
docker run -it -e DATABASE_URL=postgresql://electric:YOUR_PASSWORD@YOUR_OUTGOING_IP/postgres electricsql/electric:latest
```

#### AlloyDB

For AlloyDB, the flag to enable logical replication is called `alloydb.logical_decoding`.

### Deploy Electric

GCP provides a [wide range of container hosting](https://cloud.google.com/containers). We recommend using [Containers on Compute Engine](https://cloud.google.com/compute/docs/containers/deploying-containers) or [Google Kubernetes Engine (GKE)](https://cloud.google.com/kubernetes-engine).

For example, you can deploy Electric on a [Container-Optimized OS](https://cloud.google.com/container-optimized-os/docs) with a [Persistent Disk](https://cloud.google.com/compute/docs/disks/#pdspecs) for storing Shape logs.

> [!Warning] Don't use Cloud Run
> We **don't recommend** that you use [Cloud Run](https://cloud.google.com/run) to deploy the Electric sync service because Cloud Run uses an in-memory filesystem and does not provide persistent file storage for Shape logs.

> [!Warning] IPv6 support
> If you're connecting to Postgres over IPv6, (for example, if you're [connecting to Supabase Postgres](./supabase#deploy-postgres)) then you may need to [enable IPv6 support](/docs/guides/troubleshooting#ipv6-support) and be on a [Premium Network Tier](https://cloud.google.com/vpc/docs/subnets#ipv6-ranges).

### Deploy your app

GCP provides a range of [website hosting options](https://cloud.google.com/solutions/web-hosting?hl=en). For example you can deploy a static app to [Google Storage](https://cloud.google.com/storage/docs/hosting-static-website) with [Cloud Build](https://cloud.google.com/build/docs/overview).
