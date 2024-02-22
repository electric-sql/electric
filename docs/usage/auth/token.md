---
title: Token format
sidebar_position: 20
---

Authentication uses JSON Web Tokens, a [standard method](https://tools.ietf.org/html/rfc7519) for representing claims securely between two parties. See [more info here](https://jwt.io/introduction) and a [list of JWT libraries here](https://github.com/iamchathu/awesome-jwt#libraries).

## Required claims

### `sub`

A valid authentication JWT must contain a `sub` claim (formerly `user_id`). This must be a non-empty string, which should correspond to the primary key UUID of the authenticated app user.

:::note
Since version 0.8.0, the `sub` claim replaces the `user_id` as the standard "subject" designator in JWT tokens. However, Electric still validates tokens that have the `user_id` claim for backwards compatibility with old clients.
:::

## Validated claims

If you are using [insecure mode](./insecure.md) any other claims are optional and unvalidated.

If you are using [secure mode](./secure.md) you must also provide valid `iat` and `exp` claims. Plus, if you include values for `iss` and/or `aud` claims in your configuration, those will also be validated.

## Additional data

Additional claims will be available on the `auth` context in your [DDLX rules](../../api/ddlx.md). It's conventional to put additional data under the `data` key.

So if, in your auth JWT, you provide the following claims:

```json
{
  "sub": "000",
  "data": {
    "foo": "bar"
  }
}
```

In your DDLX statements you can lookup the value for the key `foo` as follows:

```tsx
auth.data.foo    // 'bar'
```

## Custom claim namespace

If you can't put claims that are specific to Electric at the root of your token, it is possible to define a custom namespace to put those claims under. For example, if you [start Electric](secure#example) with `AUTH_JWT_NAMESPACE=https://myapp.dev/jwt/claims`, your JWTs should look as follows:

```json
{
  "https://myapp.dev/jwt/claims": {
    "sub": "000",
    "data": {
      "foo": "bar"
    }
  }
}
```

You'll still be able to access `user_id` and additional data in your DDLX statements the usual way:

```tsx
auth.user_id     // '000'
auth.data.foo    // 'bar'
```
