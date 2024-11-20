# Electric - Proxy auth example

This example implements the [proxy auth](https://electric-sql.com/docs/guides/auth#gatekeeper-auth) pattern for [securing access](https://electric-sql.com/docs/guides/auth) to the [Electric sync service](https://electric-sql.com/product/sync).

It demonstrates how an API can proxy and authorise shape requests, by either:

- denying access
- allowing full access; or
- modifying the shape request (in this case, by adding a where clause) so the client only sees data they have permission to see

https://github.com/user-attachments/assets/eab62c23-513c-4ed8-a6fa-249b761f8667

> [!TIP]
> You can see an alternative pattern for auth in the [gatekeeper-auth](../gatekeeper-auth) example.

## Setup

1. Make sure you've installed all dependencies for the monorepo and built packages

From the root directory:

- `pnpm i`
- `pnpm run -r build`

2. Start the docker containers

`pnpm run backend:up`

3. Start the dev server

`pnpm run dev`

4. When done, tear down the backend containers so you can run other examples

`pnpm run backend:down`
