# Yjs example

This example showcases a multiplayer [Codemirror](https://codemirror.net/) editor with [YJS](https://github.com/yjs/yjs) and [ElectricSQL](https://electric-sql.com/). All data is synchronized through [Postgres](https://www.postgresql.org/), eliminating the need for additional real-time infrastructure.

Y-Electric is a [YJS connection provider](https://docs.yjs.dev/ecosystem/connection-provider) that comes with offline support, integrates with [database providers](https://docs.yjs.dev/ecosystem/database-provider) and handles Awareness. It works with the entire YJS ecosystem and with your existing apps too!

Check the Y-Electric [package](https://github.com/electric-sql/electric/tree/main/packages/y-electric) to learn more.

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
cd examples/yjs
```

Start the example backend services using [Docker Compose](https://docs.docker.com/compose/):

```shell
pnpm backend:up
```

> Note that this always stops and deletes the volumes mounted by any other example backend containers that are running or have been run before. This ensures that the example always starts with a clean database and clean disk.

Now start the dev server:

```shell
pnpm dev:server
```

And the client app

```
pnpm dev:client
```

When you're done, stop the backend services using:

```shell
pnpm backend:down
```
