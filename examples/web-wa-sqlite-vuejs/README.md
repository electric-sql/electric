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

# ElectricSQL - Web example (Vue.js)

This is an example web application using ElectricSQL in the browser with [Vue.js](https://vuejs.org) and [wa-sqlite](https://github.com/rhashimoto/wa-sqlite).

## Instructions

Clone the [electric-sql/electric](https://github.com/electric-sql/electric) mono-repo and change directory into this example folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/web-wa-sqlite-vuejs
```

## Pre-reqs

You need [NodeJS >= 16.11 and Docker Compose v2](https://electric-sql.com/docs/usage/installation/prereqs).
```

## Install

Install the dependencies:

```sh
npm install
```

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
# or `yarn client:watch`` to re-generate whenever the DB schema changes
```

## Run

Start your app:

```sh
npm run dev
```

Open [localhost:5173](http://localhost:5173) in your web browser.

## Develop

`./src/Example.tsx` has the main example code. For more information see the:

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)

If you need help [let us know on Discord](https://discord.electric-sql.com).
