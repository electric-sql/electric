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

# ElectricSQL - notifications example

This is a web application using ElectricSQL in the browser with [wa-sqlite](https://electric-sql.com/docs/integrations/drivers/web/wa-sqlite), demonstrating how a notification system for activities between users could be implemented with a thin schema and a few components.


## Instructions

Clone the [electric-sql/electric](https://github.com/electric-sql/electric) mono-repo and change directory into this example folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/push-notifications
```

## Pre-reqs

You need [NodeJS >= 16.11 and Docker Compose v2](https://electric-sql.com/docs/usage/installation/prereqs). Install `yarn` if you don't have it already:

```shell
npm -g install yarn
```

## Install

Install the dependencies:

```sh
yarn
```

## Setup

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
yarn backend:up
# Or `yarn backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
yarn db:psql
```

Setup your [database schema](https://electric-sql.com/docs/usage/data-modelling):

```shell
yarn db:migrate
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
yarn client:generate
# or `yarn client:watch`` to re-generate whenever the DB schema changes
```

## Run

Start your app:

```sh
yarn start
```

Open [localhost:3001](http://localhost:3001) in your web browser.

## Develop

The components `./src/UserSelector.tsx` and `./src/UserView.tsx` contain the main notification related code, along with the database schema defined in `./db/migrations/01-create_notification_tables.sql`. Subsequent migrations only add sample data for the purpose of this example application.

For more information see the:

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)

If you need help [let us know on Discord](https://discord.electric-sql.com).
