# Basic Tanstack Query example

This is an example TanStack application developed using ElectricSQL for read path sync, together with Tanstack Query for local writes with optimistic state.

See the [Electric <> Tanstack integration docs](https://electric-sql.com/docs/integrations/tanstack) for more context and a [video of the example running here](https://x.com/msfstef/status/1828763769498952173).

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
cd examples/tanstack
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