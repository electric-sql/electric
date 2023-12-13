---
title: Secure mode
description: >-
  Designed for production use.
customProps:
  mode: true
sidebar_position: 30
---

This is the default and the recommended auth mode to use for running ElectricSQL apps in production. In secure mode, Electric authenticates its replication connections by obtaining a JWT from each client and verifying its validity before allowing data streaming in either direction.

## Example

When starting the Electric server, specify which signature verification algorithm to use and include an appropriate key to use for the verification. A working example:

```shell
$ docker run \
    -e AUTH_JWT_ALG=ES256 \
    -e AUTH_JWT_KEY="$(cat public_key.pem)" \
    electric-sql/electric
```

Now, all you need to authenticate your client is a JWT that includes a `sub` claim (formerly `user_id`) and is signed using the same `ES256` algorithm and the matching private key.

See the [JWT library for your programming environment](https://github.com/iamchathu/awesome-jwt#libraries) for more information. Below are two examples for generating a token manually and using Elixir:

<Tabs groupId="backend-technology">

<TabItem value="manual" label="Generate manually">

Let's use [token.dev](https://token.dev) to hand-craft a token with static claims for demonstration purposes.

For example, using the following claims

```
{
  "sub": "1",
  "iat": 1684749213,
  "exp": 1684759213
}
```

and private key

```
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgW2MZVQ7AU4H+nt4C
04gbp2z7RW2x9nq3TyrhE8HmKG+hRANCAARzSZvWgxQXm/Ijh2c7CmxF95UGuAe5
ukKuQqBjA9f1kESEBwiVcNmwQwaIiOS84a+K/w3MgP9I2PRKHvAOd+Pf
-----END PRIVATE KEY-----
```

we get the following signed JWT

```
eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJ1c2VyX2lkIjoiMSIsImlhdCI6MTY4NDc0OTIxMywiZXhwIjoxNjg0NzU5MjEzfQ.dLd_bG5_VayLzTemgATu566NP3itwafMbu1zgef_8mB6VGHojczsXyh3g7QE4GM_l8kUQm9MJN7OWg8Kf-40YQ
```

</TabItem>

<TabItem value="elixir" label="Using Elixir">

Make sure to add [joken](https://hex.pm/packages/joken) and [jason](https://hex.pm/packages/jason) to your Mix deps.

```elixir
defmodule JWTUtil do
  def signed_auth_token(user_id, private_key) do
    config = Joken.Config.default_claims()
    signer = Joken.Signer.create("ES256", %{"pem" => private_key})
    Joken.generate_and_sign!(config, %{"sub" => user_id}, signer)
  end
end

user_id = "1"

private_key = """
  -----BEGIN PRIVATE KEY-----
  MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgW2MZVQ7AU4H+nt4C
  04gbp2z7RW2x9nq3TyrhE8HmKG+hRANCAARzSZvWgxQXm/Ijh2c7CmxF95UGuAe5
  ukKuQqBjA9f1kESEBwiVcNmwQwaIiOS84a+K/w3MgP9I2PRKHvAOd+Pf
  -----END PRIVATE KEY-----
  """

JWTUtil.signed_auth_token(user_id, private_key)
#=> "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJKb2tlbiIsImV4cCI6MTY..."
```

  </TabItem>
{/*<TabItem value="typescript-node" label="TypeScript (node)">
</TabItem>
<TabItem value="ruby" label="Ruby">
</TabItem>
<TabItem value="python" label="Python">
</TabItem>
<TabItem value="php" label="PHP">
</TabItem>*/}
</Tabs>

You can now include this token in the [client instantiation code](../data-access/client.md) to have your client successfully authenticate with the server instance we configured above:

```tsx
import { electrify } from 'electric-sql/wa-sqlite'

const config = {
  auth: {
    token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJ1c2VyX2lkIjoiMSIsImlhdCI6MTY4NDc0OTIxMywiZXhwIjoxNjg0NzU5MjEzfQ.dLd_bG5_VayLzTemgATu566NP3itwafMbu1zgef_8mB6VGHojczsXyh3g7QE4GM_l8kUQm9MJN7OWg8Kf-40YQ'
  }
}

const { db } = await electrify(conn, schema, config)
```

## How the server validates auth tokens

The sync service running in secure auth mode expects the standard `iat` and `exp` claims, as well as the custom `sub` claim (formerly `user_id`) to be included in the token.

If any of `iat`, `exp`, or `nbf` claims are included, they will be validated according to the JWT specification and so your token will get rejected if any of these standard claims' values are invalid. If you additionally configure the "issuer" and/or "audience" of the Secure auth mode, then the `iss` and/or `aud` claims are also required to be included in the auth token.

## Configuration options

### `AUTH_MODE`

This is an optional setting that is set to the value `secure` by default. So to start Electric in the Secure auth mode, this variable either needs to be unset or explicitly set to the value `secure`.

### `AUTH_JWT_ALG`

The algorithm to use for signature verification. Electric supports the following algorithms:

- `HS256`, `HS384`, `HS512`: HMAC-based cryptographic signature that relies on the SHA-2 family of hash functions.
- `RS256`, `RS384`, `RS512`: RSA-based algorithms for digital signature.
- `ES256`, `ES384`, `ES512`: ECC-based algorithms for digital signature.

### `AUTH_JWT_KEY`

The key to use for signature verification. A number of different key sizes and formats are supported. You have to provide one that is compatible with the chosen algorithm.

See [Generating signing keys](#generating-signing-keys) below to learn more about generating keys for different algorithms.

### `AUTH_JWT_NAMESPACE`

This is an optional setting that specifies the location inside the token of custom claims that are specific to Electric. Currently, only the `sub` custom claim (formerly `user_id`) is required.

By default, if this setting is omitted or is set to an empty string, the `sub` / `user_id` claim is looked up at the top level. We recommend using the `https://<your-app-domain>/jwt/claims` namespace for custom claims to avoid collisions with any other applications in the future. E.g.

```
{
  "iat": 1684749213,
  "exp": 1684759213,
  "https://example.com/jwt/claims": {
    "sub": "1"
  }
}
```

### `AUTH_JWT_ISS`

This setting allows you to specificy the "issuer" that will be matched against the `iss` claim extracted from auth tokens. This can be used to ensure that only tokens created by the expected party are used to authenticate your client.

Leaving this variable empty makes the `iss` claim optional and doesn't verify its value even if it's included in token claims.

### `AUTH_JWT_AUD`

This setting allows you to specificy the "audience" that will be matched against the `aud` claim extracted from auth tokens. This can be used to ensure that only tokens for a specific application are used to authenticate your client.

Leaving this variable empty makes the `aud` claim optional and doesn't verify its value even if it's included in token claims.

## Generating signing keys

Different signature algorithms require different types of keys. Below we explain the specifics of different algorithms and show sample code to generate keys for them.

### `HS256, HS384, HS512`

These use the same _secret key_ for both signing and signature verification. The key must be a randomly generated string of characters, long enough for the chosen algorithm.

Minimum required key size is 256 bits for `HS256`, 384 bits for `HS384`, and 512 bits for `HS512`. The longer the key, the more secure the digital signature. We recommend using a 512-bit key regardless of which specific `HS*` algorithm you pick.

### `RS256, RS384, RS512`

RSA is an asymmetric cryptography algorithm that uses a private key to digitally sign a token and a matching public key to verify the signature. The minimum required key size to use with JWTs is 2048 bits.

One RSA key pair can be used for all supported `RS*` signing algorithms. It can be created as follows:

```
$ openssl genrsa -out private_key.pem 4096
$ openssl rsa -in private_key.pem -pubout -out public_key.pem
```

### `ES256, ES384, ES512`

Elliptic curve cryptography is a family of asymmetric cryptography algorithms that use smaller keys compared to RSA but provide the same or better security.

A different elliptic curve has to be used to create a key pair for every individual variation:

- `prime256v1` for `ES256`
- `secp384r1` for `ES384`
- `secp521r1` for `ES512`

Example of generating a key pair using `openssl`:

```
$ openssl ecparam -name prime256v1 -genkey | openssl pkcs8 -topk8 -nocrypt -out private_key.pem
$ openssl ec -in private_key.pem -pubout -out public_key.pem
```
