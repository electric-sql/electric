# Todo example

This is a classic TodoMVC example app, developed using ElectricSQL.

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
cd examples/todo-app
```

Start the example backend services using [Docker Compose](https://docs.docker.com/compose/):

```shell
pnpm backend:up
```

This starts Postgres and a local Electric sync service (at `http://localhost:3000`, running in insecure mode for development) using the [shared Docker Compose file](../../.support/docker-compose.yml). To point the app at a different Electric instance, set the `ELECTRIC_URL` environment variable (and `ELECTRIC_SECRET` if that instance requires an [API secret](https://electric-sql.com/docs/guides/security)).

> Note that this always stops and deletes the volumes mounted by any other example backend containers that are running or have been run before. This ensures that the example always starts with a clean database and clean disk.

Now start the dev server:

```shell
pnpm dev
```

When you're done, stop the backend services using:

```shell
pnpm backend:down
```
