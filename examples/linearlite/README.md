# linearlite

This is an example of a team collaboration app such as [Linear](https://linear.app) built using ElectricSQL.

This example is built on top of the excellent clone of the Linear UI built by
Tuan Nguyen [@tuan3w](https://github.com/tuan3w) - The original is here
[https://github.com/tuan3w/linearapp_clone](https://github.com/tuan3w/linearapp_clone).
We have replaced the canned data with a local stack running Electric in Docker.

## Run example

### Start a local Electrified Postgres

Run the Electric local-stack which is in `/local-stack`

see here https://Electric-sql.com/docs/overview/examples

```bash
cd ../../local-stack
source .envrc
docker compose pull
docker compose up -d
```

This will start a local Postgres and the Electric service on your machine.

You can then talk to the Postgres with psql using the password `password`:

`psql -h 127.0.0.1 -U postgres -d Electric `

### Configure Node

This project is using Node v16.20.0 and pnpm to manage dependencies

```
nvm use v16.20.0
npm install -g pnpm
```

### Install

In the root of the Electric folder install all the js dependencies for submodules and examples:

```
pnpm install
```

### Setup

Start Postgres and Electric using Docker (see [running the examples](https://Electric-sql.com/docs/examples/notes/running) for more options):

```shell
pnpm backend:up
# Or `yarn backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
pnpm db:psql
```

The [database schema](https://Electric-sql.com/docs/usage/data-modelling) for this example is in `db/migrations/create_tables.sql`.
You can apply it with:

```shell
pnpm db:migrate
```

Generate your [type-safe client](https://Electric-sql.com/docs/usage/data-access/client):

```shell
pnpm client:generate
# or `pnpm client:watch`` to re-generate whenever the DB schema changes
```

### Run web app

The app is a React application to install and run it:

```bash
pnpm build
pnpm start
```

The app should be available on `localhost:5173`
