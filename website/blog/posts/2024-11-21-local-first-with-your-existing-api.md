---
title: Local-first with your existing API
description: >-
  How to develop local-first apps incrementally, using your existing API.
excerpt: >-
  Local-first is often seen as eliminating your API. But what if you like your API or need to keep it as part of your stack? This post shows how you can develop local-first apps incrementally, using your existing API.
authors: [thruflo]
image: /img/blog/local-first-with-your-existing-api/humble-toaster.jpg
tags: [local-first example, postgres-sync]
outline: [2, 4]
post: true
---

<script setup>
import AuthorizingProxy from '/static/img/docs/guides/auth/authorizing-proxy.png?url'
import AuthorizingProxySmall from '/static/img/docs/guides/auth/authorizing-proxy.sm.png?url'
import AuthorizingProxyJPG from '/static/img/docs/guides/auth/authorizing-proxy.jpg?url'
import BrowserConsolePNG from '/static/img/blog/browser-console.png?url'
import NoStaleDataJGP from '/static/img/blog/no-stale-data.jpg?url'

import { onMounted } from 'vue'

import { data as initialStarCounts } from '../../data/count.data.ts'
import { getStarCount } from '../../src/lib/star-count.ts'

const formatStarCount = (count) => (
  `<span class="muted">(</span><span> ☆ </span><span>${Math.round(count / 100) / 10}k</span><span> </span><span class="muted">)</span>`
)

const renderStarCount = async (repoName, initialStarCount) => {
  const links = document.querySelectorAll(
    `.actions a[href="https://github.com/electric-sql/${repoName}"]`
  )
  links.forEach(async (link) => {
    link.innerHTML = '<span class="vpi-social-github"></span> GitHub&nbsp;'

    const countEl = document.createElement('span')
    countEl.classList.add('count')
    countEl.innerHTML = formatStarCount(initialStarCount)

    link.append(countEl)

    const count = await getStarCount(repoName, initialStarCount)
    countEl.innerHTML = formatStarCount(count)
  })
}

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    renderStarCount('electric', initialStarCounts.electric)
  }
})
</script>

One of the exciting things about [local-first software](/use-cases/local-first-software) is the potential to eliminate APIs and microservices. Instead of coding across the network, you code against a local store, data syncs in the background and your stack is suddenly much simpler.

But what if you don't want to eliminate your API? What if you want or need to keep it. How do you develop local-first software then?

With [Electric](/product/electric), you can develop local-first apps incrementally, [using your existing API](#how-it-works).

I gave a talk on this subject at the second Local-first meetup in Berlin in December 2024:

<div class="embed-container">
  <YoutubeEmbed video-id="gSGEFYuLuho" />
</div>

## The Toaster Project

There's a great book by Harvey Molotch called [Where stuff comes from](https://www.amazon.com/Where-Stuff-Comes-Toasters-Computers/dp/0415944007) which talks about how nothing exists in isolation. One of his examples is a toaster.

<figure style="max-width: 512px;">
  <div style="position:relative;height:0;padding-bottom:56.25%">
    <iframe src="https://embed.ted.com/talks/thomas_thwaites_how_i_built_a_toaster_from_scratch?subtitle=en" width="512px" height="288px" title="How I built a toaster -- from scratch" style="position:absolute;left:0;top:0;width:100%;height:100%" frameborder="0" scrolling="no" allowfullscreen>
    </iframe>
  </div>
</figure>

At first glance, a toaster seems like a pretty straightforward, standalone product. However, look a bit closer and it integrates with a huge number of other things. Like sliced bread and all the supply chain behind it. It runs on electricity. Through a standard plug. It sits on a worktop. The spring in the lever that you press down to put the toast on is calibrated to match the strength of your arm.

Your API is a toaster. It doesn't exist in isolation. It's tied into other systems, like your monitoring systems and the way you do migrations and deployment. It's hard to just rip it out, because then you break these integrations and ergonomics &mdash; and obviate your own tooling and operational experience.

For example, REST APIs are stateless. We know how to scale them. We know how to debug them. They show up in the [browser console](#browser-console). Swapping them out is all very well in theory, but what happens with your new system when it goes down in production?

### Electric's approach

At Electric, our mission is to make [sync](/use-cases/data-sync) and [local-first](/use-cases/local-first-software) adoptable for mainstream software. So, one of the main challenges we've focused on is how to use Electric with your existing software stack.

This is why we work with [any data model](/docs/guides/deployment#data-model-compatibility) in [any standard Postgres](/docs/guides/deployment#_1-running-postgres). It's why we allow you to sync data into anything from a [JavaScript object](/docs/api/clients/typescript#shape) to a [local database](/product/pglite). And it's why we focus on providing [composable primitives](/blog/2024/07/17/electric-next) rather than a one-size-fits-all solution.

As a result, with Electric, you can develop local-first apps incrementally, using your existing API. So you can get the benefits of local-first, without having to re-engineer your stack or re-invent sliced bread, just to make toast in the morning.

## How it works

First use Electric to [sync data into your app](#electric-sync). This allows your app to work with local data without it getting stale.

Then [use your API](#using-your-api) to handle:

- [auth](#auth)
- [writes](#writes)

As well as, optionally, other concerns like:

- [encryption](#encryption)
- [filtering](#filtering)

Because Electric syncs data [over HTTP](#http-and-json), you can use existing middleware, integrations and instrumentation. Like [authorization services](#external-services) and [the browser console](#browser-console).

### Electric sync

To build local-first you have to have the data locally. If you're doing that with data fetching then you have a stale data problem. Because if you're working with local data without keeping it in sync, then how do you know that it's not stale?

<figure style="max-width: 512px">
  <a :href="NoStaleDataJGP">
    <img :src="NoStaleDataJGP" />
  </a>
</figure>

This is why you need [data sync](/use-cases/data-sync). To keep the local data fresh when it changes.

Happily, this is exactly what Electric does. It [syncs data into local apps and services](/product/electric) and keeps it fresh for you. Practically what does this look like? Well, instead of fetching data using web service calls, i.e.: something like this:

```jsx
import React, { useState, useEffect } from 'react'

const MyComponent = () => {
  const [items, setItems] = useState([])

  useEffect(() => {
    const fetchItems = async () => {
      const response = await fetch('https://example.com/v1/api/items')
      const data = await response.json()

      setItems(data)
    }

    fetchItems()
  }, [])

  return <List items="items" />
}
```

Sync data using Electric, like this:

```jsx
import { useShape } from '@electric-sql/react'

const MyComponent = () => {
  const { data } = useShape({
    url: `https://electric.example.com/v1/shape`,
    params: {
      table: 'items',
    },
  })

  return <List items="data" />
}
```

For example:

- [Trigger.dev](https://trigger.dev/) started out with Electric by syncing status data from their background jobs platform into their [Realtime dashboard](https://trigger.dev/launchweek/0/realtime)
- [Otto](https://ottogrid.ai) swapped out the way they loaded data into their [AI spreadsheet](https://ottogrid.ai)

You can go much further with Electric, all the way to [syncing into a local database](/product/pglite). But you can do this _incrementally_ as and when you need to.

#### Read-path

Electric [only does the read-path sync](/docs/guides/writes#local-writes-with-electric). It syncs data out-of Postgres, into local apps.

Electric does not do write-path sync. It does not provide (or prescribe) a solution for getting data back into Postgres from local apps and services. In fact, it's explicitly designed for you to [handle writes yourself](#writes).

#### HTTP

The other key thing about Electric sync is that [it's just JSON over HTTP](/docs/api/http).

Because it's JSON you can parse it and [work with it](/docs/guides/client-development) in any language and environment. Because it's HTTP you can proxy it. Which means you can use existing HTTP services and middleware to authorize access to it.

In fact, whatever you want to do to the replication stream &mdash; [encrypt](#encryption), [filter](#filtering), transform, split, remix, buffer, you name it &mdash; you can do through a proxy. Extensibility is built in at the protocol layer.

## Using your existing API

So far, we've seen that Electric handles read-path sync and leaves [writes](#writes) up to you. We've seen how it syncs over HTTP and how this allows you to implement [auth](#auth) and other concerns like [encryption](#encryption) and [filtering](#filtering) using proxies.

Now, let's now dive in to these aspects and see exactly how to implement them using your existing API. With code samples and links to example apps.

### Auth

Web-service based apps typically authorize access to resources in a controller or middleware layer. When switching to use a sync engine without an API, you cut out these layers and typically need to codify your auth logic as database rules.

For example in [Firebase](https://firebase.google.com) you have [Security Rules](https://firebase.google.com/docs/rules) that look like this:

```js
service <<name>> {
  // Match the resource path.
  match <<path>> {
    // Allow the request if the following conditions are true.
    allow <<methods>> : if <<condition>>
  }
}
```

In Postgres-based systems, like [Supabase Realtime](https://supabase.com/docs/guides/realtime) you use Postgres [Row Level Security (RLS)](https://supabase.com/docs/guides/database/postgres/row-level-security) rules, e.g.:

```sql
create policy "Individuals can view their own todos."
on todos for select
using ( (select auth.uid()) = user_id );
```

With Electric, you don't need to do this. Electric syncs [over HTTP](/docs/api/http). You make HTTP requests to a [Shape](/docs/guides/shapes) endpoint (see
<a href="/openapi.html#/paths/~1v1~1shape/get" target="_blank">spec here</a>) at:

```http
GET /v1/shape
```

Because this is an HTTP resource, you can authorize access to it just as you would any other web service resource: using HTTP middleware. Route the request to Electric through an authorizing proxy that you control:

<a :href="AuthorizingProxyJPG">
  <img :src="AuthorizingProxy" class="hidden-sm"
      alt="Illustration of an authorzing proxy"
  />
  <img :src="AuthorizingProxySmall" class="block-sm"
      alt="Illustration of an authorzing proxy"
  />
</a>

#### API proxy

You can see this pattern implemented in the [Proxy auth example](/demos/proxy-auth).

This defines a proxy that takes an HTTP request, reads the user credentials from an `Authorization` header, uses them to authorize the request and if successful, proxies the request onto Electric:

<<< @../../examples/proxy-auth/app/shape-proxy/route.ts{typescript}

You can run this kind of proxy as part of your existing backend API. Here's [another example](/demos/gatekeeper-auth), this time using a [Plug](https://hexdocs.pm/phoenix/plug.html) to authorize requests to a [Phoenix](/docs/integrations/phoenix) application:

<<< @../../examples/gatekeeper-auth/api/lib/api_web/plugs/auth/verify_token.ex{elixir}

#### Edge proxy

If you're running Electric [behind a CDN](/docs/api/http#caching), you're likely to want to deploy your authorizing proxy in front of the CDN. Otherwise routing requests through your API adds latency and can become a bottleneck. You can achieve this by deploying your proxy as an edge function or worker in front of the CDN, for example using [Cloudflare Workers](/docs/integrations/cloudflare#auth-example) or [Supabase Edge Functions](/docs/integrations/supabase#sync-into-edge-function).

Here's a Supabase edge function using Deno that verifies that the [shape definition](/docs/guides/shapes#defining-shapes) in a JWT matches the shape definition in the request params:

<<< @../../examples/gatekeeper-auth/edge/index.ts{typescript}

#### External services

You can also use external authorization services in your proxy.

For example, [Authzed](https://authzed.com) is a low-latency, distributed authorization service based on Google Zanzibar. You can use it in an edge proxy to authorize requests in front of a CDN, whilst still ensuring strong consistency for your authorization logic.

```ts
import jwt from 'jsonwebtoken'
import { v1 } from '@authzed/authzed-node'

const AUTH_SECRET =
  Deno.env.get('AUTH_SECRET') || 'NFL5*0Bc#9U6E@tnmC&E7SUN6GwHfLmY'
const ELECTRIC_URL = Deno.env.get('ELECTRIC_URL') || 'http://localhost:3000'

const HAS_PERMISSION = v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION

function verifyAuthHeader(headers: Headers) {
  const auth_header = headers.get('Authorization')

  if (auth_header === null) {
    return [false, null]
  }

  const token = auth_header.split('Bearer ')[1]

  try {
    const claims = jwt.verify(token, AUTH_SECRET, { algorithms: ['HS256'] })

    return [true, claims]
  } catch (err) {
    console.warn(err)

    return [false, null]
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  const [isValidJWT, claims] = verifyAuthHeader(req.headers)
  if (!isValidJWT) {
    return new Response('Unauthorized', { status: 401 })
  }

  // See https://github.com/authzed/authzed-node and
  // https://authzed.com/docs/spicedb/getting-started/discovering-spicedb

  const client = v1.NewClient(claims.token)

  const resource = v1.ObjectReference.create({
    objectType: `example/table`,
    objectId: claims.table,
  })

  const user = v1.ObjectReference.create({
    objectType: 'example/user',
    objectId: claims.user_id,
  })

  const subject = v1.SubjectReference.create({
    object: user,
  })

  const permissionRequest = v1.CheckPermissionRequest.create({
    permission: 'read',
    resource,
    subject,
  })

  const checkResult = await new Promise((resolve, reject) => {
    client.checkPermission(permissionRequest, (err, response) =>
      err ? reject(err) : resolve(response)
    )
  })

  if (checkResult.permissionship !== HAS_PERMISSION) {
    return new Response('Forbidden', { status: 403 })
  }

  return fetch(`${ELECTRIC_URL}/v1/shape${url.search}`, {
    headers: req.headers,
  })
})
```

#### Gatekeeper pattern

Another pattern, illustrated in our [gatekeeper-auth example](/demos/gatekeeper-auth), is to:

1. use an API endpoint to authorize shape access
2. generate shape-scoped auth tokens
3. validate these tokens in the proxy

This allows you to keep more of your auth logic in your API and minimise what's executed on the "hot path" of the proxy. This is actually what the code example shown in the [edge proxy](#edge-proxy) section above does, using an edge worker to validate a shape-scoped auth token.

You can also achieve the same thing using a standard reverse proxy like [Caddy](https://caddyserver.com/), [Nginx](https://nginx.org) or [Varnish](https://varnish-cache.org). For example, [using Caddy](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/caddy):

<<< @../../examples/gatekeeper-auth/caddy/Caddyfile{hcl}

The workflow from the client's point of view is to first hit the gatekeeper endpoint to generate a shape-scoped auth token, e.g.:

```console
$ curl -sX POST "http://localhost:4000/gatekeeper/items" | jq
{
  "headers": {
    "Authorization": "Bearer <token>"
  },
  "url": "http://localhost:4000/proxy/v1/shape",
  "table": "items"
}
```

Then use the token to authorize requests to Electic, via the proxy, e.g.:

```console
$ curl -sv --header "Authorization: Bearer <token>" \
      "http://localhost:4000/proxy/v1/shape?table=items&offset=-1"
...
< HTTP/1.1 200 OK
...
```

The [Typescript client](/docs/api/clients/typescript) supports auth headers and `401` / `403`error handling, so you can wrap this up using, e.g.:

<<< @../../examples/gatekeeper-auth/client/index.ts{ts}

### Writes

Electric does [read-path](#read-path) sync. That's the bit between Postgres and the client in the diagramme below. Electric **does not** handle writes. That's the dashed blue arrows around the outside, back from the client into Postgres:

<figure>
  <a href="/img/api/shape-log.jpg">
    <img srcset="/img/api/shape-log.sm.png 1064w, /img/api/shape-log.png 1396w"
        sizes="(max-width: 767px) 600px, 1396px"
        src="/img/api/shape-log.png"
        alt="Shape log flow diagramme"
    />
  </a>
</figure>

Instead, Electric is designed for you to implement writes yourself. There's a comprehensive [Writes guide](/docs/guides/writes) and [Write patterns example](/demos/write-patterns) that walks through a range of approaches for this that integrate with your existing API.

You can also see a number of the examples that use an API for writes, including the [Linearlite](/demos/linearlite), [Phoenix LiveView](/demos/phoenix-liveview) and [Tanstack](/demos/tanstack) examples.

#### API server

To highlight a couple of the key patterns, let's look at the shared API server for the write-patterns example. It is an [Express](https://expressjs.com) app that exposes the write methods of a REST API for a table of `todos`:

- `POST {todo} /todos` to create a todo
- `PUT {partial-todo} /todos/:id` to update
- `DELETE /todos/:id` to delete

<<< @../../examples/write-patterns/shared/backend/api.js{js}

#### Optimistic writes

If you then look at the [optimistic state pattern](/docs/guides/writes#optimistic-state) (one of the approaches illustrated in the write-patterns example) you can see this being used, together with Electric sync, to support instant, local, offline-capable writes:

<<< @../../examples/write-patterns/patterns/2-optimistic-state/index.tsx{tsx}

You can also see the [shared persistent optimistic state](https://github.com/electric-sql/electric/tree/main/examples/write-ptterns/patterns/3-shared-persistent) pattern for a more resilient, comprehensive approach to building local-first apps with Electric on optimistic state.

#### Write-path sync

Another pattern covered in the Writes guide is [through the database sync](/docs/guides/writes#through-the-db). This approach uses Electric to sync into an local, embedded database and then syncs changes made to the local database back to Postgres, via your API.

The [example implementation](https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/4-through-the-db) uses Electric to sync into [PGlite](/product/pglite) as the local embedded database. All the application code needs to do is read and write to the local database. The [database schema](https://github.com/electric-sql/electric/blob/main/examples/write-patterns/patterns/4-through-the-db/local-schema.sql) takes care of everything else, including keeping a log of local changes to send to the server.

This is then processed by a sync utility that sends data to a:

- `POST {transactions} /changes` endpoint

Implemented in the [shared API server](https://github.com/electric-sql/electric/blob/main/examples/write-patterns/patterns/4-through-the-db/shared/backend/api.js) shown above:

<<< @../../examples/write-patterns/patterns/4-through-the-db/sync.ts{ts}

#### Authorizing writes

Just as [with reads](#auth), because you're sending writes to an API endpoint, you can use your API, middleware, or a proxy to authorize them. Just as you would any other API request.

Again, to emphasise, this allows you to develop local-first apps, without having to codify write-path authorization logic into database rules. In fact, in many cases, you can just keep your existing API endpoints and you may not need to change any code at all.

### Encryption

Electric syncs ciphertext as well as it syncs plaintext. You can encrypt data on and off the local client, i.e.:

- _encrypt_ it before it leaves the client
- _decrypt_ it when it comes into the client from the replication stream

You can see an example of this in the [encryption example](/demos/encryption):

<<< @../../examples/encryption/src/Example.tsx{tsx}

#### Key management

One of the challenges with encryption is key management. I.e.: choosing which data to encrypt with which keys and sharing the right keys with the right users.

There are some good patterns here like using a key per resource, such as a tenant, workspace or group. You can then encrypt data within that resource using a specific key and share the key with user when they get access to the resource (e.g.: when added to the group).

Electric is good at syncing keys. For example, you could define a shape like:

```ts
const stream = new ShapeStream({
  url: `${ELECTRIC_URL}/v1/shape`,
  params: {
    table: 'tenants',
    columns: ['keys'],
    where: `id in ('${user.tenant_ids.join(`', '`)}')`,
  },
})
```

Either in your client or in your proxy. You could then put a denormalised `tenant_id` column on all of your rows and lookup the correct key to use when decrypting and encrypting the row.

### Filtering

The [HTTP API](/docs/api/http) streams a log of change operations. You can intercept this at any level -- in your API, in a middleware proxy or when handling or materialising the log from a ShapeStream instance in the client.

## Using your existing tools

Because Electric syncs over HTTP, it integrates with standard debugging, visibility and monitoring tools.

### Monitoring

You can see Electric requests in your standard HTTP logs. You can catch errors and send them with request-specific context to systems like Sentry and AppSignal.

You can debug on the command line [using `curl`](/docs/quickstart#http-api).

### Browser console

One of the most aspects of this is being able to see and easily introspect sync requests in the browser console. This allows you to see what data is being sent through when and also allows you to observe caching and and offline behaviour.

<p style="max-width: 512px">
  <a :href="BrowserConsolePNG">
    <img :src="BrowserConsolePNG" />
  </a>
</p>

You don't need to implement custom tooling to get visibility in what's happening with Electric. It's not a black box when it comes to debugging in development and in production.

## Next steps

This post has outlined how you can develop [local-first software](/use-cases/local-first-software) incrementally, using your existing API alongside [Electric](/product/electric) for read-path sync.

To learn more and get started with Electric, see the [Quickstart](/docs/quickstart), [Documentation](/docs/intro) and source code on GitHub:

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="electric"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/electric-sql/electric"
        text="Star on GitHub"
        target="_blank"
        theme="alt"
    />
  </div>
</div>
