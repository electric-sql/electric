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

# ElectricSQL - Tauri example

This is a Tauri example using ElectricSQL, inspired from the [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) example.

It is also the showcase for a new driver, called `sqlx`.

## Instructions

Clone the [electric-sql/electric](https://github.com/electric-sql/electric) mono-repo and change directory into this example folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/tauri-postgres
```

## Pre-reqs

You need [NodeJS >= 16.11 and Docker Compose v2](https://electric-sql.com/docs/usage/installation/prereqs).

You cannot, for now, use `yarn`, because we need the `pnpm` workspaces, as we deal with local code.

You also need Rust. You can follow the official instructions from [here](https://www.rust-lang.org/tools/install).

```shell
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

On macOS, `brew install rust` should work, if you are using homebrew.

## Install

Install the dependencies:

```sh
pnpm install
```

## Setup

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
pnpm run backend:up
# Or `yarn backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
pnpm run db:psql
```

Setup your [database schema](https://electric-sql.com/docs/usage/data-modelling):

```shell
pnpm run db:migrate
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
pnpm run client:generate
# or `yarn client:watch`` to re-generate whenever the DB schema changes
```

## Run

Start your app:

```sh
pnpm tauri dev
```

Due to an unsolved bug, before closing the window, click on the `Stop Postgres` button.

## Develop

`./src/Example.tsx` has the main example code. For more information see the:

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)

If you need help [let us know on Discord](https://discord.electric-sql.com).
