<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

# ElectricSQL Beer Stars!

This is a slightly silly app to connect beers with stars and stars to beers. It may be useful to see how to integrate a server-side web application (in this case using Elixir and Phoenix) with a local-first client app, including driving the shared database schema with Ecto migrations.

## How it works

The server-side Phoenix app talks to the GitHub GraphQL API and recieves webhook events to pick up on new stars and write them into the database. The client then provides a local-first web app that creates beers and assigns them to stars.

Stars are synced onto local devices from the central Postgres. Beers and their assignments are synced from the local devices to Postgres (and out again to any other devices). This demonstrates:

1. active-active replication between Postgres and SQLite
2. adding interactive local-first behaviour on top of centrally published/aggregated data

## Prereqs

You need Docker, Docker Compose v2 and Nodejs >= 16.14 with `yarn`. See `.tool-versions` and `asdf install` if you use it.

## Install

Clone this repo and change directory into this folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/beer-stars
```

Install the dependencies:

```shell
yarn
```

Copy the wa-sqlite WASM files into `./static`:

```shell
yarn copy-wasm
```

Build the server app (requires Docker):

```shell
yarn server:build
```

### GitHub

The GitHub integration works by:

1. reading the GitHub GraphQL API to bootstrap / anti-entropy
2. handling webhook notifications

By default the app is setup to track the `electric-sql/electric` repo. You can change this by setting `GITHUB_REPO` in `./backend/.envrc`. Either way, you must edit the `GITHUB_TOKENS` in `./backend/.envrc` to contain one or more **personal access tokens** with the rights to access the GitHub repo you're tracking stars on. Tokens are space seperated e.g.:

```
export GITHUB_TOKENS="ghp_abcd ghp_efgh"
```

You also need to setup the target repo to send webhook events for [star created and deleted](https://docs.github.com/webhooks-and-events/webhooks/webhook-events-and-payloads#star) to `POST` to `/api/webhook` on the server URL, which is `localhost:40001`.

To expose this to the Internet you can use ngrok, e.g.:

```shell
ngrok http 40001
```

Then register the ngrok URL to receive the webhook events.

### Backend

Run the backend services using Docker Compose:

```shell
yarn services:up
```

This runs a Postgres database and applies the Ecto migrations defined in `./server/priv/migrations` to it.
You can connect to the databsae locally on port `54321`:

```shell
yarn db:psql
```

Another service is an Electric sync service running replication on port `5133` and a status API on post `5050`:

```shell
$ curl http://localhost:5050/api/status
{"connectors":{"postgres_1":true}}
```

Finally, the app backend that talks to GitHub's GraphQL API runs on port `40001`:

```shell
$ curl http://localhost:40001
{"errors":{"detail":"Not Found"}}
```

### Client

Generate client models from Postgres' electrified database schema:

```shell
yarn client:generate
```

This generates a type-safe database client at `./src/generated/client`.

### Run

And finally, you're good to:

```shell
yarn start
```

Open the app on [localhost:4002](http://localhost:4002). You can open in multiple tabs and devices to see the realtime sync between them.

### Allocate beers

You can allocate beers manually using the web UI. Or you can run a script to allocate beers to all the people who have already starred the repo:

```shell
yarn beers:allocate
```
