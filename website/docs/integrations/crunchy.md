---
outline: deep
title: Crunchy Data - Integrations
description: >-
  How to use Electric with Crunchy Bridge managed Postgres.
image: /img/integrations/electric-crunchy.jpg
---

<img src="/img/integrations/crunchy.svg" class="product-icon" />

# Crunchy Data

Crunchy is a Postgres hosting provider.

## Electric and Crunchy

You can use Electric with [Crunchy Bridge](https://www.crunchydata.com/products/crunchy-bridge), their managed cloud Postgres product.

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Postgres

[Sign up to Crunchy Bridge](https://crunchybridge.com/register) and go through the steps to create a cluster.

Go to the "Connection" tab, select "URL", set the role to "postgres (superuser)" and copy the connection string.

You can then run Electric with this connection string as the `DATABASE_URL`, e.g.:

```shell
docker run -it \
    -e "DATABASE_URL=postgres://postgres:****@p.YOUR_CLUSTER_ID.db.postgresbridge.com:5432/postgres" \
    electricsql/electric:latest
```

You can also use the `postgres` superuser to create other users with the `REPLICATION` role, e.g.:

```sql
CREATE ROLE electric WITH REPLICATION LOGIN PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE "postgres" to electric;
```

You can then connect as the new `electric` user.

> [!Tip] Need somewhere to host Electric?
> If you need somewhere to deploy Electric then [Crunchy works well](https://neon.tech/docs/guides/render) with [Render](./render#deploy-electric).