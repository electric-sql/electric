<p align="center">
  <a href="https://electric-sql.com" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-next.svg"
      />
      <source media="(prefers-color-scheme: light)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
      <img alt="ElectricSQL logo"
          src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/electric-sql/electric/actions"><img src="https://github.com/electric-sql/electric/actions/workflows/elixir_client_tests.yml/badge.svg"></a>
  <a href="https://github.com/electric-sql/electric/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License - Apache 2.0"></a>
  <a href="https://github.com/electric-sql/electric/milestones"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status - Alpha"></a>
  <a href="https://discord.electric-sql.com"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://x.com/ElectricSQL" target="_blank"><img src="https://img.shields.io/twitter/follow/ElectricSQL.svg?style=social&label=Follow @ElectricSQL"></a>
</p>

# Elixir client for ElectricSQL

Real-time Postgres sync for modern apps.

Electric provides an [HTTP interface](https://electric-sql.com/docs/api/http) to Postgres to enable a massive number of clients to query and get real-time updates to subsets of the database, called [Shapes](https://electric-sql.com//docs/guides/shapes). In this way, Electric turns Postgres into a real-time database.

The Elixir client helps ease reading Shapes from the HTTP API in Elixir applications.

## Installation

```elixir
def deps do
  [
    {:electric_client, "~> 0.1.0"}
  ]
end
```

## Usage

```elixir
{:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")

incomplete_todos = Electric.Client.shape("todos", where: "completed = false")

# Passing `live: false` means the stream will terminate once it's reached
# the head of the update log from Electric.
#
# Without `live: false` the stream is infinite.
stream = Electric.Client.stream(client, incomplete_todos, live: false)

messages = Enum.into(stream, [])
```

See the [Documentation](https://hexdocs.pm/electric_client).

## Testing

[Run Electric](https://github.com/electric-sql/electric/blob/main/packages/sync-service/README.md) and Postgres.

Define `DATABASE_URL` and `ELECTRIC_URL` as env vars. Or see the defaults in `config/runtime.exs`.

Then run:

```sh
mix test
```
