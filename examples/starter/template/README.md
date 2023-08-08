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
If instead you want to run Electric on top of your existing Postgres:

```sh
npm run electric:start [-- -db <pg connection url>]
```
If you don't provide a database url using the `-db` flag, you are expected to set the `DATABASE_URL` environment variable.
Also, make sure that your Postgres is configured with `wal_level = 'logical'`

Now, open a new tab in your terminal and migrate Postgres such that it contains the necessary tables for the app to work:
```sh
npm run db:migrate
```

Make sure to again set the `DATABASE_URL` environment variable prior to executing the command if you are using your own Postgres database.

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