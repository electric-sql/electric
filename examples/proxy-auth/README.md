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

This example is part of the [ElectricSQL monorepo](../..) and is designed to be built and run as part of the [pnpm workspace](https://pnpm.io/workspaces) defined in [`../../pnpm-workspace.yaml`](../../pnpm-workspace.yaml).

Navigate to the root directory of the monorepo, e.g.:

```shell
cd ../../
```

Install and build all of the workspace packages and examples:

```shell
pnpm install
pnpm run -r build
```

Navigate back to this directory:

```shell
cd examples/proxy-auth
```

Start the example backend services using [Docker Compose](https://docs.docker.com/compose/):

```shell
pnpm backend:up
```

> Note that this always stops and deletes the volumes mounted by any other example backend containers that are running or have been run before. This ensures that the example always starts with a clean database and clean disk.

Now start the dev server:

```shell
pnpm dev
```

When you're done, stop the backend services using:

```shell
pnpm backend:down
```
