# Redis Sync example

Electric automatically manages the data in your local cache for you. When the data changes, the changes are synced to the local cache which is automatically updated.

You don't need to manage cache invalidation seperately or set expiry dates of TTLs on the records in the cache. Electric handles it for you.

## Setup

1. Make sure you've installed all dependencies for the monorepo and built packages

From the root directory:

- `pnpm i`
- `pnpm run -r build`

2. Start the docker containers

`pnpm run backend:up`

3. Start the dev server

`pnpm run dev`

4. Connect a redis client to see the data in redis:
- `hkeys items` — see all the keys
- `kgetall items` — see keys/values
- `monitor` — run this to see updates as they come in. Try running this while making changes
to the items table in Postgres.

5. When done, tear down the backend containers so you can run other examples

`pnpm run backend:down`
