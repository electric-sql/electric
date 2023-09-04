---
title: Authentication
sidebar_position: 30
---

import { useCurrentSidebarCategory } from '@docusaurus/theme-common'
import AuthModesList from '@site/src/components/AuthModesList'

ElectricSQL provides a JSON Web Token based authentication mechanism for [clients](../data-access/client.md) to authenticate with the [Electric sync service](../installation/service.md).

## Overview

Your application must generate a [valid JWT](./token.md). This must have at least a `user_id` claim, which should be a non-empty string matching the primary key UUID of the authenticated user.

Pass this JWT as a string value to the [`electrify`](../../api/clients/typescript.md) function when [instantiating your client](../data-access/client.md), e.g.:

```tsx
const config = {
  auth: {
    token: '<your JWT>'
  }
}

const { db } = await electrify(conn, schema, config)
```

The client uses the JWT internally to authenticate with the Electric sync service over the [Satellite protocol](../../api/satellite.md). The sync service must be [configured](../../api/service.md) with the correct authentication mode using the `AUTH_MODE` environment variable.

## Modes

You can choose to run ElectricSQL in one of two authentication modes:

<AuthModesList />

Secure mode is designed for production use. It requires a signed JWT generated in a trusted environment (usually your backend web application).

Insecure mode is designed for development or testing. It supports unsigned JWTs that can be generated anywhere, including on the client.

## Best practices

If you have a backend for your app with a cookie-based login session mechanism already in place, we recommend creating an HTTP endpoint to generate one-off tokens for signed-in users and using that to obtain a fresh token before initializing the client.

<hr className="doc-divider" />

:::caution Work in progress
We don't currently support unauthenticated use, or changing the authentication state on an active replication connection.

[Get in touch](https://discord.electric-sql.com) if this is a blocker or you need help with a workaround.
:::
