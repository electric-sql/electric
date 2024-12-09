---
title: Auth - Guide
description: >-
  How to do authentication and authorization with Electric.
outline: [2, 3]
---

<script setup>
import AuthorizingProxy from '/static/img/docs/guides/auth/authorizing-proxy.png?url'
import AuthorizingProxySmall from '/static/img/docs/guides/auth/authorizing-proxy.sm.png?url'
import AuthorizingProxyJPG from '/static/img/docs/guides/auth/authorizing-proxy.jpg?url'

import GatekeeperFlow from '/static/img/docs/guides/auth/gatekeeper-flow.dark.png?url'
import GatekeeperFlowJPG from '/static/img/docs/guides/auth/gatekeeper-flow.jpg?url'
</script>

<img src="/img/icons/auth.svg" class="product-icon"
    style="width: 72px"
/>

# Auth

<div class="hidden-xs">

  How to do auth<span class="hidden-sm inline-md">entication and authorization</span> with Electric. Including examples for <span class="no-wrap-md">[proxy](#proxy-auth) and</span> [gatekeeper](#gatekeeper-auth)&nbsp;auth.

</div>
<div class="block-xs">

How to do auth with Electric.

Including examples for <span class="no-wrap-md">[proxy](#proxy-auth) and</span> [gatekeeper](#gatekeeper-auth)&nbsp;auth.

</div>

## It's all HTTP

The golden rule with Electric is that it's [all just HTTP](/docs/api/http).

So when it comes to auth, you can use existing primitives, such as your API, middleware and external authorization services<!-- (like [Auth0](/docs/integrations/auth0) and [Authzed](/docs/integrations/auth0)) -->.


### Shapes are resources

With Electric, you sync data using [Shapes](/docs/guides/shapes) and shapes are just resources.

You access them by making a request to `GET /v1/shape`, with the [shape definition](/docs/guides/shapes#defining-shapes) in the query string (`?table=items`, etc.). You can authorise access to them exactly the same way you would any other web resource.

### Requests can be proxied

When you make a request to Electric, you can route it through an HTTP proxy or middleware stack. This allows you to authorise the request before it reaches Electric.

<a :href="AuthorizingProxyJPG">
  <img :src="AuthorizingProxy" class="hidden-sm"
      alt="Illustration of an authorzing proxy"
  />
  <img :src="AuthorizingProxySmall" class="block-sm"
      alt="Illustration of an authorzing proxy"
  />
</a>

You can proxy the request in your cloud, or at the edge, [in-front of a CDN](#cdn-proxy). Your auth logic can query your database, or call an external service. It's all completely up-to-you.

### Rules are optional

You *don't* have to codify your auth logic into a database rule system. There's no need to use database rules to secure a sync engine when it runs over standard HTTP.

## Patterns

The two patterns we recommend and describe below, with code and examples, are:

- [proxy auth](#proxy-auth) &mdash; authorising Shape requests using a proxy
- [gatekeeper auth](#gatekeeper-auth) &mdash; using your API to generate shape-scoped access tokens

### Proxy auth

> [!Warning] GitHub example
> See the [proxy-auth example](https://github.com/electric-sql/electric/tree/main/examples/proxy-auth) on GitHub for an example that implements this pattern.

The simplest pattern is to authorise Shape requests using a reverse-proxy.

The proxy can be your API, or a seperate proxy service or edge-function. When you make a request to sync a shape, route it via your API/proxy, validate the user credentials and shape parameters, and then only proxy the data through if authorized.

For example:

1. add an `Authorization` header to your [`GET /v1/shape`](/docs/api/http#syncing-shapes) request
2. use the header to check that the client exists and has access to the shape
3. if not, return a `401` or `403` status to tell the client it doesn't have access
4. if the client does have access, proxy the request to Electric and stream the response back to the client

#### Example

When using the [Typescript client](/docs/api/clients/typescript), you can pass in a [`headers` option](/docs/api/clients/typescript#options) to add an `Authorization` header.

```tsx
const usersShape = (): ShapeStreamOptions => {
  const user = loadCurrentUser()

  return {
    url: new URL(`/api/shapes/users`, window.location.origin).href,
    headers: {
      authorization: `Bearer ${user.token}`
    }
  }
}

export default function ExampleComponent () {
  const { data: users } = useShape(usersShape())
}
```

Then for the `/api/shapes/users` route:

```tsx
export async function GET(
  request: Request,
) {
  const url = new URL(request.url)

  // Construct the upstream URL
  const originUrl = new URL(`http://localhost:3000/v1/shape`)

  // Copy over the relevant query params that the Electric client adds
  // so that we return the right part of the Shape log.
  url.searchParams.forEach((value, key) => {
    if ([`live`, `table`, `handle`, `offset`, `cursor`].includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  //
  // Authentication and authorization
  //

  const user = await loadUser(request.headers.get(`authorization`))

  // If the user isn't set, return 401
  if (!user) {
    return new Response(`user not found`, { status: 401 })
  }

  // Only query data the user has access to unless they're an admin.
  if (!user.roles.includes(`admin`)) {
    originUrl.searchParams.set(`where`, `"org_id" = ${user.org_id}`)
  }

  // When proxying long-polling requests, content-encoding &
  // content-length are added erroneously (saying the body is
  // gzipped when it's not) so we'll just remove them to avoid
  // content decoding errors in the browser.
  //
  // Similar-ish problem to https://github.com/wintercg/fetch/issues/23
  let resp = await fetch(originUrl.toString())
  if (resp.headers.get(`content-encoding`)) {
    const headers = new Headers(resp.headers)
    headers.delete(`content-encoding`)
    headers.delete(`content-length`)
    resp = new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    })
  }
  return resp
}
```

### Gatekeeper auth

> [!Warning] GitHub example
> See the [gatekeeper-auth example](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth) on GitHub for an example that implements this pattern.

The Gatekeeper pattern works as follows:

1. post to a gatekeeper endpoint in your API to generate a shape-scoped auth token
2. make shape requests to Electric via an authorising proxy that validates the auth token against the request parameters

The auth token should include a claim containing the shape definition. This allows the proxy to authorize the shape request by comparing the shape claim signed into the token with the [shape defined in the request parameters](/docs/quickstart#http-api).

This keeps your main auth logic:

- in your API (in the gatekeeper endpoint) where it's natural to do things like query the database and call external services
- running *once* when generating a token, rather than on the "hot path" of every shape request in your authorising proxy

#### Implementation

The [GitHub example](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth) provides an [`./api`](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/api) service for generating auth tokens and three options for validating those auth tokens when proxying requests to Electric:

1. [`./api`](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/api) the API itself
2. [`./caddy`](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/caddy) a Caddy web server as a reverse proxy
3. [`./edge`](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/edge) an edge function that you can run in front of a CDN

The API is an [Elixir/Phoenix](/docs/integrations/phoenix) web application that [exposes](https://github.com/electric-sql/electric/blog/main/examples/gatekeeper-auth/api/lib/api_web/router.ex) two endpoints:

1. a gatekeeper endpoint at `POST /gatekeeper/:table`
2. a proxy endpoint at `GET /proxy/v1/shape`

<figure>
  <a :href="GatekeeperFlowJPG" target="_blank">
    <img :src="GatekeeperFlow"
        alt="Illustration of the gatekeeper request flow"
    />
  </a>
</figure>

##### Gatekeeper endpoint

1. the user makes a `POST` request to `POST /gatekeeper/:table` with some authentication credentials and a shape definition in the request parameters; the gatekeeper is then responsible for authorising the user's access to the shape
2. if access is granted, the gatekeeper generates a shape-scoped auth token and returns it to the client
3. the client can then use the auth token when connecting to the Electric HTTP API, via the proxy endpoint

##### Proxy endpoint

4. the proxy validates the JWT and verifies that the shape claim in the token matches the shape being requested; if so it sends the request on to Electric
5. Electric then handles the request as normal
6. sending a response back *through the proxy* to the client

The client can then process the data and make additional requests using the same token (step 3). If the token expires or is rejected, the client starts again (step 1).

> [!Tip] Interactive walkthrough
> See [How to run](https://github.com/electric-sql/electric/blob/main/examples/gatekeeper-auth/README.md#how-to-run) on GitHub for an interactive walkthrough of the three different gatekeeper-auth example proxy options.

#### Example

See the [./client](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/client) for an example using the [Typescript client](/docs/api/clients/typescript) with gatekeeper and proxy endpoints:

<<< @../../examples/gatekeeper-auth/client/index.ts{typescript}

## Notes

### External services

Both proxy and gatekeeper patterns work well with external auth services.

If you're using an external authentication service, such as [Auth0](https://auth0.com), to generate user credentials, for example, to generate a JWT, you just need to make sure that you can decode the JWT in your proxy or gatekeeper endpoint.

If you're using an external authorization service to authorize a user's access to a shape, then you can call this whereever you run your authorization logic. For proxy auth this is the proxy. For gatekeeper auth this is the gatekeeper endpoint.

Note that if you're using a distributed auth service to ensure consistent distributed auth, such as [Authzed](https://authzed.com/), then this works best with the proxy auth pattern. This is because you explicitly *want* to authorize the user each shape request, as opposed to the gatekeeper generating a token that can potentially become stale.

### CDN <-> Proxy

If you're deploying Electric [behind a CDN](/docs/guides/deployment#caching-proxy), then it's best to run your authorising proxy at the edge, between your CDN and your user. Both proxy and gatekeeper patterns work well for this.

The gatekeeper pattern is ideal because it minimises the logic that your proxy needs to perform at the edge and minimises the network and database access that you need to provide to your edge worker. See the [edge function](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/edge) proxy option in the gatekeeper example for an example designed to run at the edge on [Supabase Edge Functions](/docs/integrations/supabase).