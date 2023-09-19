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

# ElectricSQL LinearLite Example

This is an example of a team collaboration app such as [Linear](https://linear.app) built using ElectricSQL.

It's built on top of the excellent clone of the Linear UI built by
Tuan Nguyen [@tuan3w](https://github.com/tuan3w) - The original is here
[https://github.com/tuan3w/linearapp_clone](https://github.com/tuan3w/linearapp_clone).

## Prereqs

You need Docker, Docker Compose v2 and Nodejs >= 16.14.

## Install

Clone this repo and change directory into this folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/linearlite
```

Install the dependencies:

```shell
npm install
```

## Backend

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
npm run backend:up
# Or `npm run backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
npm run db:psql
```

The [database schema](https://electric-sql.com/docs/usage/data-modelling) for this example is in `db/migrations/create_tables.sql`.
You can apply it with:

```shell
npm run db:migrate
```

## Client

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
npm run client:generate
# or `npm run client:watch`` to re-generate whenever the DB schema changes
```

## Run

The app is a React application to install and run it:

```bash
npm run build
npm run start
```

The app should be available on `localhost:5173`
