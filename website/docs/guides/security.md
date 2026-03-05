---
title: Security - Guide
description: >-
  How to secure data access and encrypt data with Electric.
outline: [2, 3]
---

<script setup>
import ComponentsJPG from '/static/img/docs/guides/deployment/components.jpg?url'
import ComponentsPNG from '/static/img/docs/guides/deployment/components.png?url'
import ComponentsSmPNG from '/static/img/docs/guides/deployment/components.sm.png?url'
</script>

<img src="/img/icons/security.svg" class="product-icon"
    style="width: 72px"
/>

# Security

How to secure data access and [encrypt data](#encryption) with Electric.

## Data access

Electric is a [sync service](/products/postgres-sync) that runs in front of Postgres. It connects to a Postgres database using a [`DATABASE_URL`](/docs/api/config#database-url) and exposes the data in that database via an [HTTP API](/docs/api/http).

<figure>
  <a :href="ComponentsJPG">
    <img :src="ComponentsPNG" class="hidden-sm"
        alt="Illustration of the main components of a successfull deployment"
    />
    <img :src="ComponentsSmPNG" class="block-sm"
        style="max-width: 360px"
        alt="Illustration of the main components of a successfull deployment"
    />
  </a>
</figure>

This API is [public by default](#public-by-default). It should be secured in production using an [API token](#api-token), [network security](#network-security) and/or an [authorization proxy](#authorization).

### Public by default

Electric connects to Postgres as a normal [database user](https://www.postgresql.org/docs/current/user-manag.html). See the [PostgreSQL Permissions guide](/docs/guides/postgres-permissions) for details on configuring database users with the necessary permissions. Electric then exposes access to **any&nbsp;data** that its database user can access in Postgres to **any&nbsp;client** that can connect to the Electric HTTP API.

You generally do _not_ want to expose public access to the contents of your database, so you **must** secure access to the Electric HTTP API.

### Network security

One way of securing access to Electric is to use a network firewall or IP whitelist.

You can often configure this using the networking rules of your cloud provider. Or you can use these to restrict public access to Electric and only expose Electric via a reverse-proxy such as Nginx or Caddy. This reverse proxy can then enforce network security rules, for example, using Caddy's [`remote-ip` request matcher](https://caddyserver.com/docs/caddyfile/matchers#remote-ip):

```hcl
@denied not remote_ip 100.200.30.40 100.200.30.41
abort @denied
```

This approach is useful when you're using Electric to sync into trusted infrastructure. However, it doesn't help when you're syncing data into client devices, like apps and web browsers. For those, you need to restrict access using an authorizing proxy.

### Authorization

Electric is designed to run behind an [authorizing proxy](/docs/guides/auth#requests-can-be-proxied).

This is the primary method for securing data access to clients and apps and is documented in detail, with examples, in the [Auth guide](/docs/guides/auth).

### API token

Access to Electric can be secured with an [API token](/docs/api/config#electric-secret). This is a secret string that can be set when starting Electric and will be used to authenticate requests to the Electric HTTP API with a `secret` query paramenter e.g. `curl http://localhost:3000/v1/shape?table=test&offset=-1&secret=MY_SECRET`. When an API token is set, Electric will require all requests to include the API token.

The token should _not_ be sent from the client as it will be exposed in the HTTP requests. Instead, it should be added by the [authorizing proxy](/docs/guides/auth#requests-can-be-proxied) when proxying requests to Electric.

## Encryption

Electric syncs ciphertext as well as it syncs plaintext. You can encrypt and decrypt data in HTTP middleware or in the local client.

### End-to-end encryption

For example, you can achieve end-to-end encryption by:

- _encrypting_ data before it leaves the client
- _decrypting_ data when it comes off the replication stream into the client

You can see an example of this in the [encryption example](/demos/encryption):

<<< @../../examples/encryption/src/Example.tsx{tsx}

### Key management

One of the primary challenges with encryption is key management. I.e.: choosing which data to encrypt with which keys and sharing the right keys with the right users.

Electric doesn't provide or prescribe any specific key management solution. You're free to use any existing key management system, such as Hashicorp Vault, for key management. However, for end-to-end encryption of shared data, you will at some point need to share keys between clients. This is a job that Electric is good at: syncing the right data to the right users.

For example, imagine you store keys in a seperate, extra secure, Postgres database and you segment your encryption by tenant (or group, or some other shared resource). You could sync keys to the client using a shape like this:

```ts
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `${ELECTRIC_URL}/v1/shape`,
  params: {
    table: 'tenants',
    columns: ['keys'],
    where: `id in ('${user.tenant_ids.join(`', '`)}')`,
  },
})
```

You could then put a denormalised `tenant_id` column on all of the synced tables in your main database and lookup the correct key to use when decrypting and encrypting the row in the client.
