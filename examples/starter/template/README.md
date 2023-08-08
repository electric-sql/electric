# Welcome to your ElectricSQL app!

## Setup

Install the dependencies:

```sh
npm install
```

## Backend

Build and start the backend:

```sh
npm run backend:start
```

The above command starts some Docker containers that run a fresh Postgres DB with the Electric sync service.
The Postgres DB will have one database that is called after the name of your app (the DB name will start with the first letter in your app name and all non-alphanumeric characters will be replaced with an underscore, e.g. app name `123foo-bar*baz` will become DB name `foo_bar_baz`).

Now, open a new tab in your terminal and migrate Postgres such that it contains the necessary tables for the app to work:
```sh
npm run db:migrate
```

## Frontend

Now build your type safe client library:
```sh
npm run client:generate
```

Finally, build and run the app:
```sh
npm run start
```

Open http://localhost:3001 in a web browser to access the application.

### Re-generate the Electric client

When you change your Postgres data model, you can watch for changes and automatically generate a new Electric client using:

```sh
npm run client:watch
```

This calls npx electric-sql generate --watch under the hood. See [https://electric-sql.com/docs/api/generator](https://electric-sql.com/docs/api/generator) for more details.

## More information

- [Documentation](https://electric-sql.com/docs)
- [Usage guide](https://electric-sql.com/docs/usage)

## Running your own Postgres

To run the Electric sync service on top of your own Postgres, make sure that Postgres is up and running.

### Postgres requirements

Postgres should be configured with `wal_level = 'logical'`.
We recommend using a fresh database because Electric uses the `postgres_1` subscription
so make sure you don’t already have a publication called `postgres_1`.
The simplest is to run Postgres as a superuser, to configure it with less permissions see <DocPageLink path="???" />.

### Running Electric sync service

To run the Electric sync service on top of your Postgres database, invoke the `electric:start` command.
Make sure to provide a database URL using the `-db` argument or set the `DATABASE_URL` environment variable.
This database URL will be used by the Electric service that runs within Docker to connect to your Postgres database.
If your Postgres database runs on the host machine, you may need to provide `host.docker.internal` as hostname,

```sh
npm run electric:start [-- -db <pg connection url>]
# for example:
# npm run electric:start -- -db postgresql://user:password@host.docker.internal:5432/postgres
```

Then, open a new tab in your terminal and set the `DATABASE_URL` environment variable again.
Now, migrate Postgres such that it contains the necessary tables for the app to work.
Note that this time, the database URL is used by the migration script (not running in Docker), so no need to use `host.docker.internal`.
```sh
npm run db:migrate
```

### Postgres <-> Electric interactions

The Electric sync service connects to Postgres using the `DATABASE_URL` environment variable.
Postgres communicates with Electric through the postgres_1 publication whose target is set by the `LOGICAL_PUBLISHER_HOST` environment variable.

```
      |---------DATABASE_URL--------->|
Electric                             Postgres
      |<----LOGICAL_PUBLISHER_HOST----|
```