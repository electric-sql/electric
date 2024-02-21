---
title: Insecure mode
description: >-
  Designed for development or testing.
sidebar_position: 40
---

Insecure mode is designed for development or testing. It supports unsigned JWTs that can be generated anywhere, including on the client, as well as signed JWTs which are accepted with no signature verification.

:::warning
Insecure mode is convenient to use in development and testing. However, you must switch to [Secure mode](./secure.md) before moving into production.
:::

## Example

When starting the Electric server, make the `AUTH_MODE` environment variable with the value `insecure` available to it. For example,

```shell
$ docker run -e AUTH_MODE=insecure electric-sql/electric
```

Now, all you need to authenticate your client is a JWT with a `sub` claim (formerly `user_id`). You can use https://token.dev/ to craft a token with static claims and then copy-paste it into your client app. Alternatively, you can use something like the following function to generate JWTs at run time:

```typescript
import jwt from 'jsonwebtoken'

function unsignedJWT(userId: string, customClaims?: object) {
  const claims = customClaims || {}

  return jwt.sign({ ...claims, sub: userId }, '', { algorithm: 'none' })
}
```

:::note
When the Electric sync server is running in insecure mode, it ignores the signing algorithm and the key. However, using the `none` algorithm when creating the JWT will produce a shorter encoded token, since it'll have an empty signature.
:::

For example, calling the above function as follows

```tsx
const token = unsignedJWT("1")
```

will produce an unsigned JWT that looks similar to this

```
eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyX2lkIjoiMSIsImlhdCI6MTY4NDg3ODEwM30.
```

Use the function to initialize the client and have your replication connection successfully authenticate with the server instance we started above:

```tsx
import { electrify } from 'electric-sql/wa-sqlite'

const userId = '...'
const token = unsignedJWT(userId)

const electric = await electrify(conn, schema)
await electric.connect(token)
```

:::note
In a more realistic scenario, instead of hard-coding a static token, you would generate a new JWT for each user that signs into your app at runtime and then pass that JWT to the client.
:::

## How the server validates auth tokens

The server running in the Insecure auth mode expects a single required claim `sub` (formerly `user_id`) to be included in the token. All other claims are optional. If any of `iat`, `exp`, or `nbf` claims are included, they will be validated according to the JWT specification and so your token will get rejected if any of these standard claims' values are invalid.

For development purposes, consider omitting standard claims from the token. If that's not possible, set a long expiration for your tokens to avoid the need to recreate them periodically or have a new token generated every time the client app is started.

## Configuration options

### `AUTH_MODE`

This is an optional setting that is set to the value `secure` by default. So to start Electric in the Insecure auth mode, this variable needs to be explicitly set to the value `insecure`.

### `AUTH_JWT_NAMESPACE`

This is an optional setting that works the same in both insecure and secure auth modes. See the documentation page for the [Secure auth mode](./secure.md#auth_jwt_namespace) to learn more.
