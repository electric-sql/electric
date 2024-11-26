# Redis Sync example

Electric automatically manages the data in your local cache for you. When the data changes, the changes are synced to the local cache which is automatically updated.

You don't need to manage cache invalidation seperately or set expiry dates of TTLs on the records in the cache. Electric handles it for you.

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
cd examples/redis-sync
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

Connect a redis client to see the data in redis, e.g.:

```shell
redis-cli -h 127.0.0.1 -p 6379
```

To see all the keys:

```console
redis> HKEYS items
```

See all the keys and values:

```console
redis> KGETALL items
```

See all updates as they come in:

```console
MONITOR
```

Try running this while making changes to the items table in Postgres, e.g. using `psql`:

```shell
psql "postgresql://postgres:password@localhost:54321/electric"
```

Insert new data and watch it sync into Redis in real time:

```sql
insert into items (id, title) values (gen_random_uuid(), 'foo');
```

When you're done, stop the backend services using:

```shell
pnpm backend:down
```
