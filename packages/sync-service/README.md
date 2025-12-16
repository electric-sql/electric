# Electricc

Electric Sync is a lightweight data synchronization service designed to sync small subsets of your Postgres data into various environments and applications, such as web and mobile apps, development environments, edge services, and local AI systems.

### Key Use Cases:

- **Web & Mobile Apps**: Replaces traditional data fetching by syncing necessary data directly into your apps.
- **Development Environments**: Synchronizes data into embedded databases like PGlite, facilitating local testing.
- **Edge Workers & Services**: Maintains low-latency data caches for edge services.
- **Local AI Systems**: Syncs data into AI systems utilizing pgvector for efficient, local data handling.

### How it Works:

Electric Sync is powered by an Elixir-based application that connects to your Postgres database via a `DATABASE_URL`. It consumes the logical replication stream and exposes an HTTP API for replicating data subsets, or "Shapes," to local environments.

For a quick setup and examples, refer to the [Quickstart guide](https://electric-sql.com/docs/quickstart).

## Running as a Standalone HTTP Endpoint

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

## Embedding into another Elixir Application

Include `:electric` into your dependencies:

    # mix.exs
    defp deps do
      [
      {:electric, ">= 1.0.0-beta.18"}
      ]
    end

Add the Postgres db connection configuration to your application's config.
Electric accepts the same configuration format as
[Ecto](https://hexdocs.pm/ecto/Ecto.html) (and
[Postgrex](https://hexdocs.pm/postgrex/Postgrex.html#start_link/1)) so you can
reuse that configuration if you want:

    # config/*.exs
    database_config = [
      database: "ecto_simple",
      username: "postgres",
      password: "postgres",
      hostname: "localhost"
    ]

    config :my_app, Repo, database_config

    config :electric, replication_connection_opts: database_config

Or if you're getting your db connection from an environment variable, then you
can use
[`Electric.Config.parse_postgresql_uri!/1`](https://hexdocs.pm/electric/Electric.Config.html#parse_postgresql_uri!/1):

    # config/*.exs
    {:ok, database_config} =
      System.fetch_env!("DATABASE_URL")
      |> Electric.Config.parse_postgresql_uri()

    config :electric, replication_connection_opts: database_config

The Electric app will startup along with the rest of your Elixir app.

Beyond the required database connection configuration there are a lot of other
optional configuration parameters. See the [`Electric` docs for more
information](https://hexdocs.pm/electric/Electric.html).
