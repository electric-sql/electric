---
title: Usage
description: How to use Electric Cloud
image: /img/meta/electric-cloud.jpg
outline: deep
---

<img src="/img/icons/ddn.svg" class="product-icon" />

# Usage

Learn how to register your database and make API requests with Electric Cloud.

## Register your Database

1. Go to [Electric Cloud](https://dashboard.electric-sql.cloud) and log in.

2. Add a new database by clicking on [New Source](https://dashboard.electric-sql.cloud/sources/new).

3. Pick a region, team, and fill in your PostgreSQL connection string. Click the connect source button to connect your database to Electric Cloud.

Once connected you should see your source details.

<img alt="Source details in cloud dashboard" src="/static/img/docs/cloud/source-details.png" />

## Making API Requests

To request a shape you need to make an API request to `https://api.electric-sql.cloud/v1/shape`.
Don't forget to include the source credentials you obtained in the previous step.

Here is an example request using `curl`:

```shell
export SOURCE_ID="8ea4e5fb-9217-4ca6-80b7-0a97581c4c10"
export SECRET="<long secret value>"

export SHAPE_DEFINITION="table=items&offset=-1"

curl -i "https://api.electric-sql.cloud/v1/shape?$SHAPE_DEFINITION\
    &source_id=$SOURCE_ID\
    &secret=$SECRET"
```

## Security Model

The source ID is a key that uniquely identifies your Postgres database. The source secret is a token that grants access to it.

> [!Warning] Do not use your source secret in the client!
> If you use the source secret from a client, then this exposes it to malicious users.
>
> See the [security guide](/docs/guides/security) for more context.

### Proxy Auth

The recommended pattern is to add the source ID and secret parameter to the origin request made by your [auth proxy](/docs/guides/auth) or API.

See the [Cloud overview](/cloud/) for detailed examples.










## Usage

### Register your Database

1. Go to [Electric Cloud](https://dashboard.electric-sql.cloud) and log in.

2. Add a new database by clicking on [New Source](https://dashboard.electric-sql.cloud/sources/new).

3. Pick a region, team, and fill in your PostgreSQL connection string. Click the connect source button to connect your database to Electric Cloud.

Once connected you should see your source details akin to the screenshot below.

<img alt="Source details in cloud dashboard" src="/static/img/docs/cloud/source-details.png" />

It shouldn't take long before the source `state` becomes `active` and you're ready to make your first API request.

### Making API Requests

To request a shape you need to make an API request to `https://api.electric-sql.cloud/v1/shape`.
Don't forget to include the source credentials you obtained in the previous step.
If you don't recall them you can always find them in your user dashboard.

Here is an example request using `curl`:

```shell
export SOURCE_ID="8ea4e5fb-9217-4ca6-80b7-0a97581c4c10"
export SECRET="<long secret value>"

export SHAPE_DEFINITION="table=items&offset=-1"

curl -i "https://api.electric-sql.cloud/v1/shape?$SHAPE_DEFINITION\
    &source_id=$SOURCE_ID\
    &secret=$SECRET"
```

### Security Model

The source ID is a key that uniquely identifies your Postgres database.

The source secret is a token that grants access to it. You should treat the source secret as securely as you would with your database password.

> [!Warning] Do not use your source secret in the client!
> If you use the source secret from a client, then this exposes it to malicious users, who can then use it to connect to your cloud API.
>
> See the [security guide](/docs/guides/security) for more context.

#### Proxy Auth

The recommended pattern for secure use of the Electric Cloud is to add the source ID and secret parameter to the origin request made by your [auth proxy](/docs/guides/auth) or API. (You can proxy requests to Electric using an edge worker, or an API. In many cases, this can be your [existing backend API](/blog/2024/11/21/local-first-with-your-existing-api#using-your-existing-api)).

##### Example

In your client, request the shape as normal, without the `source_id` and `secret` parameters. For example here using the [Typescript client](/docs/api/clients/typescript):

```ts
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `https://your-api-or-proxy.example.com/v1/shape`,
  params: {
    table: `items`,
  },
})
```

Then add the source ID and secret to the origin request in your [auth proxy](/docs/guides/auth). For example here using a Next.js [Route Handler](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)):

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
  originUrl.searchParams.set(`secret`, process.env.SOURCE_SECRET)

  // Proxy the authorised request on to the Electric Cloud.
  const response = await fetch(originUrl)

  // Fetch decompresses the body but doesn't remove the
  // content-encoding & content-length headers which would
  // break decoding in the browser.
  //
  // See https://github.com/whatwg/fetch/issues/1729
  const headers = new Headers(response.headers)
  headers.delete(`content-encoding`)
  headers.delete(`content-length`)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
```

### Pricing

Electric Cloud is currently free in public BETA. We'll be launching low-cost, usage-based pricing soon (by the end of Q3 2025).

Electric Cloud will always provide a generous free tier, so many apps will roll over with zero cost. If your plan is to use Electric in a larger app (more than 1,000 monthly active users) please reach out to make sure we can fully support you and to get a sense of what the future pricing will be like.