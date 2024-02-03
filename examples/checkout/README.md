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

The app is deployed here for you to try out: http://checkout-demo.electric-sql.com/

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

## Running the app

There are two methods described below to run the app:

1. [Run locally using a local Supabase stack](#run-locally-using-a-local-supabase-stack) 
2. [Run against hosted Supabase, with a local Electric sync service](#run-against-hosted-supabase)

## Run locally using a local Supabase stack

Start local Supabase and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
npm run backend:up
# Or `npm run backend:start` to foreground
```

If you need to change the configuration of ports for the local Supabase docker containers, that can be done in `./backend/.env`

Setup your [database schema](https://electric-sql.com/docs/usage/data-modelling):

```shell
npm run db:migrate
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
npm run client:generate
# or `npm run client:watch`` to re-generate whenever the DB schema changes
```

Load the stores catalog into the database:

```shell
npm run db:load-data
```

Start your app:

```sh
npm run dev
```

Open [localhost:3001](http://localhost:5173) in your web browser.

## Run against hosted Supabase

If you don't yet have a Supabase account visit [supabase.com](supabase.com) and create one.

### 1. Setting up a Supabase Postgres

Log in to your Supabase dashboard and click "New Project". In the form enter a name for the database, and a password that will be used to connect to it. Make a note of this password and save it somewhere secure.

### 2. Enable the `pg_net` extension

Go to the "Database" section of the project, and select "Extensions". Search for "pg_net" and enable it for the "extension" schema.

### 3. Retrieving the Project reference id

Go to "Project Settings" (look for the gear icon at the bottom of the icon menu on the left hand side of the page) and open the "General" section. In the top section copy the "Project reference id". This is used for deploying the edge function.

### 4. Retrieving the connection details

Now open the "Database" section. Under the heading "Connection string" select the URI tab. Copy the connection string shown and save it somewhere.

You will use this as the value for the DATABASE_URL in your Electric sync service configuration.

### 5. Retrieving the Project URL and JWT and API authentication keys

Now open the "API" section of the project settings. Copy the "Project URL", this is the value you will use for the `ELECTRIC_SUPABASE_URL` setting below.

Copy the `anon`/`public` and `service_roll` API keys. These are used for the `ELECTRIC_SUPABASE_ANON_KEY` and trigger "Bearer Token" respectively.

Scroll down to the "JWT settings". Reveal and copy the "JWT Secret" value. You will use this as the value for AUTH_JWT_KEY in your Electric sync service configuration.

### 6. Configuring Electric and the app to connect to Supabase

Edit the `./electric/docker-compose.yml` file, setting the `DATABASE_URL` and `AUTH_JWT_KEY` to the values retrieved above.

Edit the `./.env` file and set `ELECTRIC_SUPABASE_URL`,  `ELECTRIC_SUPABASE_ANON_KEY` and `DATABASE_URL` to the values retrieved above. 

### 7. Modify the `AFTER INSERT` trigger

Edit the `./db/migrations/02-create_process_item_trigger.sql` file so that the `"Authorization":"Bearer xxxx"` "Bearer Token" value is that of the `service_roll` API key you retrieved above.

Also, edit the URL of the edge function so that the hostname is the "Project URL" you retrieved above. Leave the `/v1/process` after the hostname in place. The resulting URL should looks like:

```
'https://qwertyuiopasdfghjklz.supabase.co/functions/v1/process'
```

### 8. Deploy the Edge Function

To deploy the "process" edge function from `./supabase/function/process` run this command with the "Project reference id" you retrieved above.

```sh
npx supabase functions deploy process --project-ref xxxxxxxxxxxxx
```

### 9. Start a local Electric sync service

To run the local electric sync service run:

```sh
cd ./electric
docker compose up
```

### 9. Migrate the database, load the store catalog and generate the client

To apply the migrations to the database, run:

```sh
node ./db/migrate.js
```

Load the stores catalog into the database:

```shell
npm run db:load-data
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
npm run client:generate
# or `npm run client:watch`` to re-generate whenever the DB schema changes
```

### 10. Run the App

To start the app run:

```sh
npm run dev
```

## Develop

For more information see the:

- [Electric with Supabase documentation](https://electric-sql.com/docs/deployment/supabase)
- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)

If you need help [let us know on Discord](https://discord.electric-sql.com).
