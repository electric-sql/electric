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

# ElectricSQL - Web example

This is an example web application using ElectricSQL in the browser with [wa-sqlite](https://github.com/rhashimoto/wa-sqlite).

## Instructions

Clone this repo and change directory into this folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/web-wa-sqlite
```

Install the dependencies:

```shell
yarn
```

You can start the backend services for this example using docker:

```shell
yarn backend:start
```

If you're looking into running the services yourself, check the instructions in [running the examples](https://electric-sql.com/docs/examples/notes/running#running-your-own-postgres) page, which has information on how to connect Electric sync service to an existing Postgres database. 

> In that case, make sure you set the `DATABASE_URL` environment variable before running the following commands.

Initialise the schema for the app in your backend Postgres:

```shell
yarn db:migrate
```

Generate the TypeScript client from the current database schema:

```
yarn client:generate
```

You're now ready to start the app:

```sh
yarn start
```

That's it! You're running a local-first app that syncs changes with other connected devices through the Electric sync service.



## Evolving the schema

During development, it might be useful to automatically re-generate the client to reflect changes made to the database schema.

You can watch for database schema changes and automatically generate a new client with:

```sh
yarn client:watch
```

Now, open a `psql` shell to the backend Postgres:

```shell
yarn db:connect
```

And modify the items table:

```sql
ALTER TABLE items ADD COLUMN another TEXT;
```

This will trigger the client generator and automatically update the data model in the source code. Go ahead and check that attribute `another` is immediately available in the `Items` model.

## More information

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)
