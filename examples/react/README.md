# Basic example

This is an example of a basic ElectricSQL app using React. The Electric-specific code is in [`./src/Example.tsx`](./src/Example.tsx).

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
cd examples/react
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

You should see three items listed in the page. These are created when first running the [`./db/migrations`](./db/migrations).

Now let's connect to Postgres, e.g.: using `psql`:

```shell
psql "postgresql://postgres:password@localhost:54321/electric"
```

Insert new data and watch it sync into the page in real time:

```sql
insert into items (id) values (gen_random_uuid());
```

When you're done, stop the backend services using:

```shell
pnpm backend:down
```