# Electric

Electric Sync is a lightweight data synchronization service designed to sync small subsets of your Postgres data into various environments and applications, such as web and mobile apps, development environments, edge services, and local AI systems.

### Key Use Cases:

- **Web & Mobile Apps**: Replaces traditional data fetching by syncing necessary data directly into your apps.
- **Development Environments**: Synchronizes data into embedded databases like PGlite, facilitating local testing.
- **Edge Workers & Services**: Maintains low-latency data caches for edge services.
- **Local AI Systems**: Syncs data into AI systems utilizing pgvector for efficient, local data handling.

### How it Works:

Electric Sync is powered by an Elixir-based application that connects to your Postgres database via a `DATABASE_URL`. It consumes the logical replication stream and exposes an HTTP API for replicating data subsets, or "Shapes," to local environments.

For a quick setup and examples, refer to the [Quickstart guide](https://electric-sql.com/docs/quickstart).

## Running

Run Postgres:

```sh
docker compose -f dev/docker-compose.yml create
docker compose -f dev/docker-compose.yml start
```

Source the `.env.dev` somehow, e.g.:

```sh
set -a; source .env.dev; set +a
```

Run the Elixir app:

```sh
mix deps.get
iex -S mix
```
