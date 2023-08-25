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

# ElectricSQL - Expo example

This is an example mobile app using [Expo](https://expo.dev) with the [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) driver.

## Pre-reqs

See the [Expo installation docs here](https://docs.expo.dev/get-started/installation/). Plus you need [NodeJS and Docker Compose](https://electric-sql.com/docs/usage/installation/prereqs).

## Install

Clone the [electric-sql/electric](https://github.com/electric-sql/electric) mono-repo and change directory into this example folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/expo
```

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

Run in the iOS simulator:

```shell
yarn start:ios
```

## More information

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)

If you need help [let us know on Discord](https://discord.electric-sql.com).
