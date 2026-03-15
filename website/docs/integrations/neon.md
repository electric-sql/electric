---
outline: deep
title: Neon - Integrations
description: >-
  How to use Electric with Neon's serverless Postgres.
image: /img/integrations/electric-neon.jpg
---

<img src="/img/integrations/neon.svg" class="product-icon" />

# Neon

[Neon](https://neon.tech) is a serverless Postgres hosting platform.

## Electric and Neon

You can use Electric with Neon's [serverless Postgres hosting](https://neon.tech/docs/introduction/serverless).

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Postgres

[Sign up to Neon](https://neon.tech/docs/get-started-with-neon/signing-up) and go through the steps to create a database.

On the project page, go to `Settings -> Logical Replication` and click "Enable".

> [!Tip] Neon and logical replication
> See the [Neon guide on logical replication](https://neon.tech/docs/guides/logical-replication-neon) for information about how logical replication works with the rest of the Neon feature set.

### Connect Electric

Go to the Dashboard page and copy the database connection string.

Make sure you **don't** check "Pooled connection". You want the direct connection string in order to use logical replication.

You can then run Electric with this connection string as the `DATABASE_URL`, e.g.:

```shell
docker run -it \
    -e "DATABASE_URL=YOUR_NEON_CONNECTION_STRING" \
    electricsql/electric:latest
```

> [!Tip] Need somewhere to host Electric?
> If you need somewhere to deploy Electric then [Neon works well](https://neon.tech/docs/guides/render) with [Render](./render#deploy-electric).

## PGlite

Electric and Neon have also collaborated to develop [PGlite](/products/pglite), which was started as a project by Neon's CTO, [Stas Kelvich](https://github.com/kelvich).
