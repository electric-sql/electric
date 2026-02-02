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

You _don't_ have to codify your auth logic into a database rule system.

There's no need to use database rules to [secure data access](/docs/guides/security) when your sync engine runs over standard HTTP.

## Patterns

The two patterns we recommend and describe below, with code and examples, are:

- [proxy auth](#proxy-auth) &mdash; authorising Shape requests using a proxy
- [gatekeeper auth](#gatekeeper-auth) &mdash; using your API to generate shape-scoped access tokens

### Proxy auth

> [!Warning] GitHub example
> See the [proxy-auth example](https://github.com/electric-sql/electric/tree/main/examples/proxy-auth) on GitHub for an example that implements this pattern.

The simplest pattern is to authorise Shape requests using a reverse-proxy.

The proxy can be your API, or a separate proxy service or edge-function. When you make a request to sync a shape, route it via your API/proxy, validate the user credentials and set the shape parameters server-side, and then only proxy the data through if authorized.

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
      authorization: `Bearer ${user.token}`,
    },
  }
}

export default function ExampleComponent() {
  const { data: users } = useShape(usersShape())
}
```

Then for the `/api/shapes/users` route:

```tsx
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export async function GET(request: Request) {
  const url = new URL(request.url)

  // Construct the upstream URL
  const originUrl = new URL(`http://localhost:3000/v1/shape`)

  // Only pass through Electric protocol parameters
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set the table server-side - not from client params
  originUrl.searchParams.set(`table`, `users`)

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
    // For type-safe WHERE clause generation, see the section below
    originUrl.searchParams.set(`where`, `org_id = '${user.org_id}'`)
  }

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

#### Type-safe where clause generation

The example above uses simple string-based WHERE clauses, which works well for straightforward cases. If you'd like type-safe WHERE clause generation with compile-time validation, you can use query builder libraries like Drizzle or Kysely. This is particularly useful for complex queries or when you want to catch column reference errors at compile-time rather than runtime.

> [!Tip] General pattern
> These examples show JavaScript/TypeScript APIs, but you can use this same pattern of type-safe where clause generation in any language with similar query builder libraries for your backend API.

**Drizzle** — fully type-safe operators with schema inference:

```tsx
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './schema' // Your Drizzle schema definition

export async function GET(request: Request) {
  // ... setup code ...

  const user = await loadUser(request.headers.get('authorization'))
  if (!user || user.roles.includes('admin')) {
    // admins see everything
  } else {
    // Build type-safe WHERE expression using column.name for unqualified column names
    // TypeScript will error if you reference users.nonexistentColumn
    const whereExpr = sql`${sql.identifier(users.org_id.name)} = ${user.org_id}`

    // Compile to SQL fragment without DB connection
    const qb = new QueryBuilder()
    const { sql: query, params } = qb
      .select()
      .from(users)
      .where(whereExpr)
      .toSQL()

    // Extract just the WHERE clause fragment
    const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')
    originUrl.searchParams.set('where', fragment)

    // Add params as individual query parameters: params[1]=value, params[2]=value, etc.
    params.forEach((value, index) => {
      originUrl.searchParams.set(`params[${index + 1}]`, String(value))
    })
  }

  // ... fetch and return response ...
}
```

**Kysely** — type-safe expression builder with generated schema:

```tsx
import { db } from './db' // Your Kysely instance with generated types

export async function GET(request: Request) {
  // ... setup code ...

  if (!user.roles.includes('admin')) {
    // TypeScript will error if you reference invalid columns
    const query = db
      .selectFrom('users')
      .selectAll()
      .where('org_id', '=', user.org_id)
      .where('status', '=', 'active')

    const { sql: query, parameters } = query.compile()
    const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')
    fragment = fragment.replace(/\b\w+\./g, '') // Remove table prefixes
    originUrl.searchParams.set('where', fragment)

    // Add params as individual query parameters: params[1]=value, params[2]=value, etc.
    parameters.forEach((value, index) => {
      originUrl.searchParams.set(`params[${index + 1}]`, String(value))
    })
  }
}
```

> [!Note] Handling parameterized queries
> Electric's HTTP API accepts parameters via individual query params (`params[1]=value`, `params[2]=value`) which are used to safely substitute `$1`, `$2` placeholders in WHERE clauses. This prevents SQL injection while maintaining type safety.
>
> **Drizzle**: Use `column.name` with `sql.identifier()` to generate unqualified column names (e.g., `"org_id"` instead of `"users"."org_id"`), since Electric expects column names without table prefixes.
>
> **Kysely**: Table prefixes are included by default, so strip them with `.replace(/\b\w+\./g, '')` after extracting the WHERE fragment.

Both **Drizzle** and **Kysely** provide full compile-time type safety based on your schema definitions. TypeScript will error if you reference invalid columns, use incorrect types, or apply incompatible operators.

Benefits:

- **Compile-time validation**: Catch errors before runtime
- **SQL injection protection**: Values are properly escaped and parameterized
- **Refactoring safety**: Renaming columns updates all references automatically
- **IDE support**: Auto-completion for column names and types

#### Using POST for subset queries

When WHERE clauses become large (complex ACL subqueries, many parameters, or `WHERE id = ANY($1)` with hundreds of IDs), GET requests can fail with `HTTP 414 Request-URI Too Long` errors. Electric supports POST requests with subset parameters in the JSON body to avoid URL length limits.

:::warning URL Length Limits and GET Deprecation
GET requests with subset parameters in the URL can fail with `414 Request-URI Too Long` errors. This is common when:
- ACL subqueries generate long WHERE clauses
- Join queries produce large filter lists
- Parameter arrays contain many values

**Use POST to avoid this limitation.**

> **Deprecation Notice:** In Electric 2.0, GET requests for subset snapshots will be deprecated and only POST will be supported. Implement POST support now to ensure forward compatibility.
:::

##### POST body format

The POST body accepts these subset parameters as JSON:

| Parameter | Type | Description |
|-----------|------|-------------|
| `where` | string | WHERE clause to filter the subset |
| `params` | object | Parameters as `{"1": "value1", "2": "value2"}` for `$1`, `$2` placeholders |
| `limit` | integer | Maximum rows to return (requires `order_by`) |
| `offset` | integer | Rows to skip for pagination (requires `order_by`) |
| `order_by` | string | ORDER BY clause (required when using limit/offset) |

Example POST body:

```json
{
  "where": "\"organization_id\" = $1 AND (\"owner_user_id\" = $2 OR ...)",
  "params": {"1": "org_123", "2": "user_456"},
  "order_by": "created_at DESC",
  "limit": 100
}
```

##### URL vs POST body parameters

Electric separates parameters by purpose:

**URL query parameters** (shape definition — always in URL):
- `table` — Root table name (required)
- `offset` — Shape log position (required, e.g., `-1` for initial sync)
- `handle` — Shape handle for continuation requests
- `columns` — Column selection
- `where` — Main shape WHERE clause (for non-subset queries)
- `replica`, `log`, `live`, `live_sse` — Protocol options
- `secret` / `api_secret` — API authentication

**POST body parameters** (subset snapshot parameters):
- `where` — Subset WHERE clause (applied _in addition to_ main shape WHERE)
- `params` — Parameters for the subset WHERE clause
- `limit`, `offset`, `order_by` — Pagination controls

##### Security: how Electric combines WHERE clauses

Electric always combines the main shape WHERE (URL) with the subset WHERE (POST body) using `AND`:

```sql
WHERE {main_shape_where} AND ({subset_where})
```

This means **subset queries can only narrow results, never widen them**. Even if a client sends `where: "1=1"` in the POST body, the main shape WHERE still applies. The subset WHERE is validated for syntax and prohibited from containing subqueries.

##### Parameters your proxy must control

The proxy must set these **shape definition parameters** server-side — they define what data the client can access:

| Parameter | Where | Security Consideration |
|-----------|-------|------------------------|
| `table` | URL | **Must be set server-side.** Letting clients specify the table allows access to any table. |
| `columns` | URL | **Should be set server-side.** Clients could request sensitive columns. |
| `where` | URL | **Must be set server-side.** This is your authorization filter — the main shape WHERE that restricts all queries. |
| `secret` | URL | **Must be set server-side.** Never expose the API secret to clients. |

##### Parameters safe to pass through from clients

These parameters are safe because they either can't widen data access or are needed for client sync state:

| Parameter | Where | Notes |
|-----------|-------|-------|
| `offset` | URL | Shape log position — clients need to track their sync position |
| `handle` | URL | Shape handle — clients need this to continue syncing |
| `live` | URL | Live mode flag — controls long-polling behavior |
| `live_sse` | URL | SSE mode flag — controls streaming behavior |
| `replica` | URL | Replica mode — controls update message format |
| `log` | URL | Log mode — `full` or `changes_only` |
| `where` | POST body | Subset WHERE — combined with AND, can only narrow results |
| `params` | POST body | Parameters for subset WHERE |
| `limit` | POST body | Pagination limit |
| `offset` | POST body | Pagination offset (different from shape log offset in URL) |
| `order_by` | POST body | Sorting for pagination |

:::tip Key Principle
Your proxy is an **authorization layer** that controls the **shape definition** (table, columns, main WHERE). Clients can freely use subset parameters to filter and paginate within that shape — Electric ensures they can only narrow results, never escape the main WHERE clause.
:::

##### Implementing POST support in your proxy

To support both GET and POST requests:

1. **Accept both methods** on your proxy endpoints
2. **Set shape definition server-side** — table, columns, and main WHERE clause
3. **For POST**: Forward client subset params (they can only narrow results)
4. **For GET**: Send WHERE as URL query parameters (existing behavior)

```tsx
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export async function handler(request: Request) {
  const url = new URL(request.url)
  const method = request.method

  // Construct the upstream Electric URL
  const originUrl = new URL(`http://localhost:3000/v1/shape`)

  // Pass through Electric protocol parameters (offset, handle, live, etc.)
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Authentication
  const user = await loadUser(request.headers.get(`authorization`))
  if (!user) {
    return new Response(`unauthorized`, { status: 401 })
  }

  // Set shape definition server-side (this is your authorization layer)
  originUrl.searchParams.set(`table`, `items`)
  originUrl.searchParams.set(`where`, `"organization_id" = '${user.org_id}'`)
  originUrl.searchParams.set(`secret`, process.env.ELECTRIC_SECRET)

  // Forward request to Electric
  let response: Response
  if (method === 'POST') {
    // POST: Forward client body (subset params can only narrow results)
    const clientBody = await request.text()
    response = await fetch(originUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: clientBody, // Client subset params (where, limit, order_by, etc.)
    })
  } else {
    // GET: Simple proxy
    response = await fetch(originUrl)
  }

  // Forward response to client (remove problematic headers)
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

##### Client configuration for POST

When using the TypeScript client with a proxy, configure `subsetMethod: 'POST'` in your shape options:

```tsx
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: '/api/shapes/items',  // Your proxy endpoint
  headers: {
    Authorization: `Bearer ${token}`,
  },
  subsetMethod: 'POST',  // Send subset requests as POST
})
```

Or with TanStack DB collections:

```tsx
const collection = createCollection(
  electricCollectionOptions({
    schema: itemsSchema,
    shapeOptions: {
      url: '/api/shapes/items',
      headers: {
        Authorization: async () => `Bearer ${await getToken()}`,
      },
      subsetMethod: 'POST',  // Use POST for subset queries
    },
    getKey: (item) => item.id,
  }),
)
```

:::warning GET Deprecation in Electric 2.0
GET requests for subset snapshots will be **deprecated in Electric 2.0** — only POST will be supported. Plan your migration now:

1. Deploy proxy with dual GET/POST support (backwards compatible)
2. Update clients to use `subsetMethod: 'POST'`
3. Monitor for 414 errors — they should disappear
4. Before upgrading to Electric 2.0, ensure all clients use POST
:::

### Gatekeeper auth

> [!Warning] GitHub example
> See the [gatekeeper-auth example](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth) on GitHub for an example that implements this pattern.

> [!Note] Exception to the proxy pattern
> Unlike the proxy pattern above where shape parameters are set server-side, the gatekeeper pattern is designed to authorize specific shape configurations requested by the client. The client provides the full shape definition, and the gatekeeper explicitly authorizes that exact shape configuration.

The Gatekeeper pattern works as follows:

1. post to a gatekeeper endpoint in your API to generate a shape-scoped auth token
2. make shape requests to Electric via an authorising proxy that validates the auth token against the request parameters

The auth token should include a claim containing the shape definition. This allows the proxy to authorize the shape request by comparing the shape claim signed into the token with the [shape defined in the request parameters](/docs/quickstart#http-api). The proxy validates that the client is requesting exactly the same shape that was authorized by the gatekeeper.

This keeps your main auth logic:

- in your API (in the gatekeeper endpoint) where it's natural to do things like query the database and call external services
- running _once_ when generating a token, rather than on the "hot path" of every shape request in your authorising proxy

#### Implementation

The [GitHub example](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth) provides an [`./api`](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/api) service for generating auth tokens and three options for validating those auth tokens when proxying requests to Electric:

1. [`./api`](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/api) the API itself
2. [`./caddy`](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/caddy) a Caddy web server as a reverse proxy
3. [`./edge`](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/edge) an edge function that you can run in front of a CDN

The API is an [Elixir/Phoenix](/docs/integrations/phoenix) web application that [exposes](https://github.com/electric-sql/electric/blob/main/examples/gatekeeper-auth/api/lib/api_web/router.ex) two endpoints:

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
6. sending a response back _through the proxy_ to the client

The client can then process the data and make additional requests using the same token (step 3). If the token expires or is rejected, the client starts again (step 1).

> [!Tip] Interactive walkthrough
> See [How to run](https://github.com/electric-sql/electric/blob/main/examples/gatekeeper-auth/README.md#how-to-run) on GitHub for an interactive walkthrough of the three different gatekeeper-auth example proxy options.

#### Example

See the [./client](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/client) for an example using the [Typescript client](/docs/api/clients/typescript) with gatekeeper and proxy endpoints:

<<< @../../examples/gatekeeper-auth/client/index.ts{typescript}

### Dynamic Auth Options

The TypeScript client supports function-based options for headers and params, making it easy to handle dynamic auth tokens:

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  headers: {
    // Token will be refreshed on each request
    Authorization: async () => `Bearer ${await getAccessToken()}`,
  },
})
```

This pattern is particularly useful when:

- Your auth tokens need periodic refreshing
- You're using session-based authentication
- You need to fetch tokens from a secure storage
- You want to handle token rotation automatically

The function is called when needed and its value is resolved in parallel with other dynamic options, making it efficient for real-world auth scenarios.

### Handling Auth Errors

Both proxy and gatekeeper patterns can return 401 or 403 errors when authentication fails or tokens expire. Use the `onError` callback to handle these errors and retry with refreshed credentials:

```typescript
const stream = new ShapeStream({
  url: '/api/shapes/items',
  headers: {
    Authorization: `Bearer ${currentToken}`,
  },
  onError: async (error) => {
    if (error instanceof FetchError && error.status === 401) {
      // Token expired - refresh and retry
      const newToken = await refreshAuthToken()
      return {
        headers: {
          Authorization: `Bearer ${newToken}`,
        },
      }
    }

    // For other errors, stop syncing
  },
})
```

**Important:** The return value controls stream behavior:

- **Return `{ headers }`** or **`{ params }`** - Retry with updated values
- **Return `{}`** - Retry with same config (useful for transient errors)
- **Return void** - Stop the stream

Note: 5xx server errors are automatically retried with exponential backoff. See the [TypeScript client error handling docs](/docs/api/clients/typescript#error-handling) for complete details.

## Session Invalidation with Vary Headers

When users log out or their authentication status changes, it's important to ensure they can't access cached shapes that they should no longer have access to. The HTTP `Vary` header is crucial for this.

### The Problem

Without proper cache control, browsers and CDNs might serve cached shape responses even after a user logs out. This happens because the cache key typically only includes the URL, not the authentication context.

### The Solution: Vary Header

Add a `Vary` header to your shape responses to include authentication information in the cache key:

```http
Vary: Authorization
```

or for cookie-based auth:

```http
Vary: Cookie
```

### Implementation Examples

#### With Authorization Headers

```tsx
export async function GET(request: Request) {
  // ... auth logic ...

  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)

  // Add Vary header for Authorization-based auth
  headers.set('Vary', 'Authorization')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
```

#### With Cookie-based Auth

```tsx
export async function GET(request: Request) {
  // ... auth logic ...

  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)

  // Add Vary header for cookie-based auth
  headers.set('Vary', 'Cookie')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
```

#### Multiple Auth Methods

If you support multiple authentication methods:

```tsx
// For both Authorization header and Cookie support
headers.set('Vary', 'Authorization, Cookie')
```

### How It Works

The `Vary` header tells browsers and CDNs to include the specified headers when creating cache keys. This means:

- Authenticated requests get cached separately from unauthenticated ones
- Different users' requests are cached separately
- When a user logs out and loses their auth credentials, they can't access cached authenticated responses

This ensures proper isolation of cached shape data based on authentication context.

## Notes

### External services

Both proxy and gatekeeper patterns work well with external auth services.

If you're using an external authentication service, such as [Auth0](https://auth0.com), to generate user credentials, for example, to generate a JWT, you just need to make sure that you can decode the JWT in your proxy or gatekeeper endpoint.

If you're using an external authorization service to authorize a user's access to a shape, then you can call this whereever you run your authorization logic. For proxy auth this is the proxy. For gatekeeper auth this is the gatekeeper endpoint.

Note that if you're using a distributed auth service to ensure consistent distributed auth, such as [Authzed](https://authzed.com/), then this works best with the proxy auth pattern. This is because you explicitly _want_ to authorize the user each shape request, as opposed to the gatekeeper generating a token that can potentially become stale.

### CDN <-> Proxy

If you're deploying Electric [behind a CDN](/docs/guides/deployment#caching-proxy), then it's best to run your authorising proxy at the edge, between your CDN and your user. Both proxy and gatekeeper patterns work well for this.

The gatekeeper pattern is ideal because it minimises the logic that your proxy needs to perform at the edge and minimises the network and database access that you need to provide to your edge worker. See the [edge function](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth/edge) proxy option in the gatekeeper example for an example designed to run at the edge on [Supabase Edge Functions](/docs/integrations/supabase).
