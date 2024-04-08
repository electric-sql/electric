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

# ElectricSQL - React Native example

This is an example mobile app using [React Native](https://reactnative.dev) with the [@op-engineering/op-sqlite](https://github.com/OP-Engineering/op-sqlite) driver.

## Pre-reqs

See the React Native CLI Quickstart section at [reactnative.dev/docs/environment-setup](https://reactnative.dev/docs/environment-setup). Plus you need [NodeJS and Docker Compose](https://electric-sql.com/docs/usage/installation/prereqs).

## Install

Install the dependencies:

```sh
npm install
```

Install the [pods](https://cocoapods.org) (if you get a `pod: command not found` error, then you need to [install CocoaPods](https://guides.cocoapods.org/using/getting-started.html)):

```sh
npm run pods:install
```

You may want to also check the [op-sqlite documentation](https://ospfranco.notion.site/Installation-Flags-93044890aa3d4d14b6c525ba4ba8686f) for additional steps you might need
to configure the native modules for your target environments.

## Setup

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
npm run backend:up
# Or `npm run backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
npm run db:psql
```

Setup your [database schema](https://electric-sql.com/docs/usage/data-modelling):

```shell
npm run db:migrate
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
npm run client:generate
# or `npm run client:watch`` to re-generate whenever the DB schema changes
```

## Run

Run on the iOS simulator:

```shell
npm run start:ios
```

Run on the Android emulator:

```shell
npm run start:android
```

## More information

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)

If you need help [let us know on Discord](https://discord.electric-sql.com).
