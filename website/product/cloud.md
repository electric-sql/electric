---
title: Cloud
description: >-
  Hosted Electric sync that's blazing fast
  and scales to millions of users
outline: deep
---

<script setup>
import { onMounted } from 'vue'

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    let links = document.querySelectorAll('.cloud-cta a.VPButton.brand')

    links.forEach((link) => {
      if (link.querySelector('span.vpi-electric-icon')) {
        return
      }

      const icon = document.createElement('span')
      icon.classList.add('vpi-electric-icon')

      link.prepend(icon)
    })
  }
})
</script>

<img src="/img/icons/ddn.svg" class="product-icon" />

# Cloud <Badge type="warning" text="public beta" />

Hosted Electric sync that's blazing fast
and scales to millions of users

<div class="cloud-cta">
  <VPButton
      href="https://dashboard.electric-sql.cloud/"
      text="Sign up "
      theme="brand"
  />
</div>

## Hosted Electric

Electric Cloud is a hosted Electric service. We provision, run and operate the [Electric sync engine](/product/electric) for you.

## Data delivery network

Electric [syncs data over HTTP](/docs/api/http). This allows it to integrate with CDN infrastructure. Electric Cloud leverages this to provide a global Data Delivery Network

This allows you to scale out real-time data to [millions of concurrent users](/docs/reference/benchmarks#cloud) from a single commodity Postgres. With fast load times, low latency and consistent, low resource use.

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
    &source_secret=$SECRET"
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

In your client, request the shape as normal, without the `source_id` and `source_secret` parameters. For example here using the [Typescript client](/docs/api/clients/typescript):

```ts
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `https://your-api-or-proxy.example.com/v1/shape`,
  params: {
    table: `items`
  }
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
  originUrl.searchParams.set(`source_secret`, process.env.SOURCE_SECRET)

  // Proxy the authorised request on to the Electric Cloud.
  return fetch(originUrl, {headers: req.headers})
}
```

### Pricing

Electric Cloud is currently free in public BETA. We'll be launching low-cost, usage-based pricing soon (likely by the end of June 2025).

Electric Cloud will always provide a generous free tier, so many apps will roll over with zero cost. If your plan is to use Electric in a larger app (more than 1,000 monthly active users) please reach out to make sure we can fully support you and to get a sense of what the future pricing will be like.

### Support

Let us know if you have any questions. We'll be very happy to help. You can ask questions on [Discord](https://discord.electric-sql.com) or email us directly at [support@electric-sql.com](mailto:support@electric-sql.com).

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/product/cloud/sign-up"
        text="Sign-up for Cloud"
        theme="brand"
    />
  </div>
</div>
