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

This is an example mobile app using [React Native](https://reactnative.dev) with the [react-native-sqlite-storage](https://www.npmjs.com/package/react-native-sqlite-storage) driver.

## Pre-reqs

See the React Native CLI Quickstart section at [reactnative.dev/docs/environment-setup](https://reactnative.dev/docs/environment-setup). Plus you need [NodeJS and Docker Compose](https://electric-sql.com/docs/usage/installation/prereqs).

## Install

Clone the [electric-sql/electric](https://github.com/electric-sql/electric) mono-repo and change directory into this example folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/react-native
```

Install the dependencies:

```sh
yarn
```

Install the [pods](https://cocoapods.org) (if you get a `pod: command not found` error, then you need to [install CocoaPods](https://guides.cocoapods.org/using/getting-started.html)):

```sh
yarn pods:install
```

You may want to also check the [install section of the react-native-sqlite-storage driver README](https://github.com/andpor/react-native-sqlite-storage#installation).

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
