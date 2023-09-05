# linearlite

This is an example of a team collaboration app such as [linear](https://linear.app) built using electric-sql.

This example is built on top of the excellent clone of the Linear UI built by 
Tuan Nguyen [@tuan3w](https://github.com/tuan3w) - The original is here 
[https://github.com/tuan3w/linearapp_clone](https://github.com/tuan3w/linearapp_clone). 
We have replaced the canned data with a local stack running electric in Docker.


## Run example

### Start a local electrified Postgres

Run the electric local-stack which is in `/local-stack`

see here https://electric-sql.com/docs/overview/examples

```bash
cd ../../local-stack
source .envrc
docker compose pull
docker compose up -d
```

This will start a local Postgres and the Electric service on your machine.

You can then talk to the Postgres with psql using the password `password`:

```psql -h 127.0.0.1 -U postgres -d electric ```

### Configure Node

This project is using Node v16.20.0 and pnpm to manage dependencies

```
nvm use v16.20.0
npm install -g pnpm
```

### Install 

In the root of the electric folder install all the js dependencies for submodules and examples:

```
pnpm install
```

Then build the electric code generator and the typescript client:

```
cd generator
pnpm build
cd ../clients/typescript
pnpm build
cd ../..
```

### Apply migrations to Postgres

This example uses a SQL file in `db/migration.sql` to manage the Postgres schema. 
You can apply it with:

```bash
pnpm migrate
```

This will create tables in Postgres and electrify them.

## Setup

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
pnpm backend:up
# Or `yarn backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
pnpm db:psql
```

The [database schema](https://electric-sql.com/docs/usage/data-modelling) for this example is in `db/migrations/create_tables.sql`.
You can apply it with:

```shell
pnpm db:migrate
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

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
The app should be available on `localhost:8000`