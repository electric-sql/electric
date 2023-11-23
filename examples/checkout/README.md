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

# Checkout ElectricSQL + Supabase Example

This is an example web application using ElectricSQL in the browser with [wa-sqlite](https://github.com/rhashimoto/wa-sqlite), using [Supabase](http://supabase.com) with it's auth and edge functions, and the [Ionic Framework](http://ionicframework.com) for the UI.

Supabase Auth is used to register and sign in a user, the Supabase JWT is then used to establish a connection with Electric.

A Supabase Edge Function is used to process the card payment on submission of the checkout. The card details would be converted to a token by a payment provider and attached to the order record, there is then a trigger on the `order` table. When a new order is inserted it calls a edge function to process the order updating it's status in real time and syncing that with the visitors local checkout.

Included in the repo is a docker compose setup than enables you to run Supabase locally with Electric - the instructions below start this for development.

## Instructions

Clone the [electric-sql/electric](https://github.com/electric-sql/electric) mono-repo and change directory into this example folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/supabase-basic
```

## Pre-reqs

You need [NodeJS >= 16.11 and Docker Compose v2](https://electric-sql.com/docs/usage/installation/prereqs).

## Install

Install the dependencies:

```sh
npm install
```

If you need to change the configuration of ports, that can be done in `./backend/.env`

## Setup

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
npm run backend:up
# Or `npm run backend:start` to foreground
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

Start your app:

```sh
npm run dev
```

Open [localhost:3001](http://localhost:5173) in your web browser.

## Develop

For more information see the:

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)

If you need help [let us know on Discord](https://discord.electric-sql.com).
