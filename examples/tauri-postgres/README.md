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

# ElectricSQL Tauri Example

This is an example of a team collaboration app such as [Linear](https://linear.app) built using ElectricSQL and Tauri.

It's built on top of the excellent clone of the Linear UI built by
Tuan Nguyen [@tuan3w](https://github.com/tuan3w) - The original is here
[https://github.com/tuan3w/linearapp_clone](https://github.com/tuan3w/linearapp_clone).

## Prereqs

You need Docker, Docker Compose v2, Nodejs >= 16.14 and pnpm.

## Install

Clone this repo and change directory into this folder:

```sh
git clone https://github.com/electric-sql/electric
```

Build the Electric generator and client library:

```sh
pnpm install
cd clients/typescript && pnpm build
cd ../../generator && pnpm build
```

Change directory into this folder:

```sh
cd ../examples/tauri-postgres
```

Install the dependencies:

```shell
pnpm install
```

Setup the third party libraries and software that the app needs, according to your platform:

For macOS:
```
bash install-darwin.sh
```

For linux:
```
bash install-linux.sh
```

This will take up a few hundreds megabytes of space, during the installation, because the macOS postgres and the linux ollama download is large.

## Backend

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
pnpm run backend:up
# Or `npm run backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
pnpm run db:psql
```

The [database schema](https://electric-sql.com/docs/usage/data-modelling) for this example is in `db/migrations/create_tables.sql`.
You can apply it with:

```shell
pnpm run db:migrate
```

## Client

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
pnpm run client:generate
```

## Run

The app is a Tauri application. To run it:

```bash
pnpm tauri dev
```

and to build a distributable package:

```bash
pnpm tauri build
```
