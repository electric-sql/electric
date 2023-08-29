
# Server

This is an Elixir Phoenix application.

It starts up a worker that polls the GitHub GraphQL API for stargazers and writes them into a Postgres database.

And it provides an endpoint at `POST /api/webhook` to handle webhook notifications when stars are created and deleted.

## Usage

Setup:

```sh
mix setup
```

Run:

```sh
BEER_STARS_WORKER=true mix phx.server
```

Test:

```sh
mix test
```
