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

The recommended pattern for secure use of the Electric Cloud is to add the source ID and secret parameter to the origin request made by your [auth proxy](/docs/guides/auth).

Specifically, this means you request shapes in your client as normal, without the `source_id` and `source_secret`. For example using the [Typescript client](/docs/api/clients/typescript):

```ts
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `https://api.electric-sql.cloud/v1/shape`,
  params: {
    table: `items`
  }
})
```

Then add the source ID and secret to the origin request in your [auth proxy](/docs/guides/auth). For example (using a Next.js [route handler](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)):

```ts
export async function GET(req: Request) {
  const proxyUrl = new URL(req.url)

  // ... validate and authorize the request ...

  // Construct the origin URL.
  const originUrl = new URL(`/v1/shape`, `https://api.electric-sql.cloud`)
  proxyUrl.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value)
  })

  // Add the source params.
  originUrl.searchParams.set(`source_id`, process.env.SOURCE_ID)
  originUrl.searchParams.set(`source_secret`, process.env.SOURCE_SECRET)

  // Proxy the authorised request on to the Electric Cloud.
  return fetch(originUrl, {headers: req.headers})
}
```

See the [security guide](/docs/guides/security) for more context.

### Support

Let us know if you have any questions. We'll be very happy to help.
