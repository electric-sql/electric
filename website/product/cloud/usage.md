---
title: Usage
description: >-
  Usage instructions for the Electric Cloud private BETA.
outline: [2, 3]
---

<script setup>
import AccessCredsPNG from '/static/img/docs/cloud/access-creds.png?url'
</script>

<img src="/img/icons/ddn.svg" class="product-icon" />

# Usage

Usage instructions for the Electric Cloud <Badge type="info" text="PRIVATE BETA" />.

> [!Warning] Invitation only
> These instructions are only for teams that have been invited to the Electric Cloud private BETA. To get access, please [sign-up](./sign-up) to the waitlist.

## Using the Electric Cloud

Once onboarded, you will be given a source ID and secret for each Postgres database you've connected to Electric:

<figure>
  <img :src="AccessCredsPNG" />
</figure>

You should store these somewhere secure (like in your password manager) and use them when making requests to the cloud API at `https://api.electric-sql.cloud/v1/shape`.

### Curl example

For example using `curl`:

```shell
export SOURCE_ID="8ea4e5fb-9217-4ca6-80b7-0a97581c4c10"
export SOURCE_SECRET="<long secret value>"

export SHAPE_DEFINITION="table=items&offset=-1"

curl -i "https://api.electric-sql.cloud/v1/shape?$SHAPE_DEFINITION\
    &source_id=$SOURCE_ID\
    &source_secret=$SOURCE_SECRET"
```

## Security model

The source ID is a key that uniquely identifies your Postgres database.

The source secret is a token that grants access to it. You should treat the source secret as securely as you would your database password.

> [!Warning] Do not leak your source secret to the client
> If you use the source secret from an insecure client, then this exposes it to malicious users, who can then use it to connect to your cloud API.

### Proxy auth

The recommended pattern for secure use of the Electric Cloud is to add the `source_secret` parameter to the origin request made by your [auth proxy](/docs/guides/auth).

For example, you can set the `source_id` as a parameter in your client request:

```ts
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `https://api.electric-sql.cloud/v1/shape`,
  params: {
    table: `items`,
    source_id: `8ea4e5fb-9217-4ca6-80b7-0a97581c4c10`
  }
})
```

And then add the corresponding secret when [proxying](/docs/guides/auth) the request to the Electric origin from your trusted auth proxy:

```js
Deno.serve((req) => {
  const url = new URL(req.url)

  // ... validate and authorize the request here ...

  // Read the source ID from the request.
  const sourceId = url.searchParams.get('source_id')

  // Lookup the source secret e.g.: from an env var or some kind of secret store.
  const sourceSecret = lookupSecret(sourceId)

  // Add to the origin url.
  const originUrl = `${ELECTRIC_URL}/v1/shape${url.search}&source_secret=${sourceSecret}`

  // Proxy the request.
  return fetch(originUrl, {headers: req.headers})
})
```

See the [security guide](/docs/guides/security) for more context.

### Support

Let us know if you have any questions. We'll be very happy to help.
