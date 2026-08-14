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

## Internal live-request multiplexing

Electric exposes an authenticated WebSocket upgrade at
`GET /v1/shape/multiplex` for trusted proxies that need to park many silent
live waits without retaining one HTTP request process per wait. This endpoint
uses the `electric.shape-multiplex.v1` WebSocket subprotocol. It is only
available on the active Electric instance; read-only instances reject the
upgrade.

The client sends JSON text frames to add or remove logical waits:

```json
{"type":"watch","id":"request-1","handle":"...","offset":"12_0","cursor":"123"}
{"type":"unwatch","id":"request-1"}
```

`cursor` is the raw value of the previous `electric-cursor` header, or `null`
when there is no previous value. Electric may acknowledge an armed wait with
`{"type":"ready","id":"request-1"}`. It then sends one terminal frame:

```json
{"type":"wake","id":"request-1","reason":"changes"}
{"type":"wake","id":"request-1","reason":"rotation"}
{"type":"no_change","id":"request-1","response":{"status":200,"headers":{},"body":[]}}
{"type":"error","id":"request-1","code":"...","message":"...","retryable":true}
```

Wake frames deliberately carry no shape rows. The proxy must issue the normal
shape HTTP request after a wake. A `no_change` frame contains the lowercase
HTTP response headers and JSON body that the proxy should return to the
unchanged shape client. The server uses its configured long-poll timeout and
removes every wait after a terminal frame.

Embedded deployments can call `Electric.Plug.ShapeMultiplexPlug` directly. An
optional `:availability_guard` zero-arity function can enforce tenant ownership;
it must return `:ok` while the socket is valid and is rechecked periodically.
