
# Welcome to your ElectricSQL app!

Start the backend:

```shell
yarn backend:start
```

Open a new tab in your terminal. Navigate back to the same folder. Apply the migrations (defined in `./db/migrations`):

```shell
yarn db:migrate
```
The above command applies all sql files in the migrations folder so make sure they are idempotent if you run the command multiple times.
Or, alternatively, use proper migration tooling.

Generate your client:

```sh
yarn client:generate
```

Start your app:

```sh
yarn start
```

Open [localhost:3001](http://localhost:3001) in your web browser.

## Changing your database schema

You can watch for database schema changes and automatically generate a new client using:

```sh
yarn client:watch
```

## Notes

- `yarn backend:start` uses Docker Compose to start Postgres and the [Electric sync service](https://electric-sql.com/docs/api/service). See [running the examples](https://electric-sql.com/docs/examples/notes/running#running-your-own-postgres) for information about configuring the Electric sync service to run against an existing Postgres database.
- `yarn client:watch` calls `npx electric-sql generate --watch` under the hood. See [https://electric-sql.com/docs/api/generator](https://electric-sql.com/docs/api/generator) for more details.

## More information

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)
