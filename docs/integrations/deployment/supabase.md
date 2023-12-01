---
title: Supabase
description: >-
  An open source Firebase alternative built on Postgres.
sidebar_position: 55
---

ElectricSQL works with [Supabase](https://supabase.com).

We support both the hosted [Supabase Platform](https://supabase.com/docs/guides/platform) and [self-host, open source](https://supabase.com/docs/guides/self-hosting) Supabase.

Supabase is an open source Firebase alternative. It provides a Postgres database, authentication, APIs, edge functions, realtime subscriptions, storage and vector embeddings. Supabase is **not** an application or web service host. To use Electric with Supabase, you still need to deploy your own Electric sync service.

:::note
Electric support for Supabase is currently enabled in the Canary build, available as the `electricsql/electric:canary` docker image.
:::

## How to connect Electric to Supabase Postgres

1. [Setting up a Supabase Postgres](#1-setting-up-a-supabase-postgres)
2. [Retrieving the connection details from the Supabase dashboard](#2-retrieving-the-connection-details)
3. [Retrieving the authentication key](#3-retrieving-the-authentication-key)
4. [Configuring Electric to connect to Supabase](#4-configuring-electric-to-connect-to-supabase)
5. [Verifying Electric initialisation](#5-verifying-electric-initialisation)
6. [Electrifying tables](#6-electrifying-tables)

### 1. Setting up a Supabase Postgres

If you don't yet have a Supabase account visit [supabase.com](https://supabase.com) and create one.

Log in to your Supabase dashboard and click "New Project". In the form enter a name for the database, and a password that will be used to connect to it. Make a note of this password. Select an AWS region for your database to be hosted in. To reduce latency, we recommend that this is close to, or ideally in same region as, your Electric sync service.

:::info
All Supabase Postgres instances come with logical replication enabled and the permissions needed for Electric to work.
:::

### 2. Retrieving the connection details

Once you've created your database in the Supabase dashboard, go to "Project Settings" > "Database" in the Supabase dashboard. Under the heading "Connection string" select the `URI` tab and copy the connection string shown. You will use this as the value for the `DATABASE_URL` in your [Electric sync service configuration](../../api/service.md).

:::caution
Do not use the "Connection Pool" connection string displayed a little further down the screen.

This will prevent the sync service from operating. Because is connects via PgBouncer, which does not support logical replication.
:::

### 3. Retrieving the authentication key

Still in the Supabase dashboard, select "Project Settings" -> "API".

Scroll down to the "JWT settings". Copy the "JWT Secret" value. You will use this as the value for `AUTH_JWT_KEY` in your [Electric sync service configuration](../../api/service.md).

### 4. Configuring Electric to connect to Supabase

Run your [Electric sync service](../../api/service), either locally or [via one of the other deployment options](./index.md), with the following [configuration options](../../api/service.md#configuration-options):

- set `AUTH_JWT_ALG` to `HS512` to enable secure auth mode with the right signing algorithm
- set `AUTH_JWT_KEY` to the "JWT Secret" value you retrieved in step 3 above
- set `DATABASE_URL` to the connection string you retrieved and constructed in step 2 above
- set `ELECTRIC_INBOUND_MODE` to `direct_writes`
- set `PG_PROXY_PASSWORD` to a secure password value and note it down

Depending on how you run Electric these could be passed as arguments to Docker, set in a ENV file or entered into a managed host's dashboard.

For example, to run Electric locally using Docker (replacing the `...` placeholder values with your specific values):

```shell
docker run \
    -e "AUTH_JWT_ALG=HS512" \
    -e "AUTH_JWT_KEY=..." \
    -e "DATABASE_URL=..." \
    -e "ELECTRIC_INBOUND_MODE=direct_writes" \
    -e "PG_PROXY_PASSWORD=..." \
    -e "PG_PROXY_PORT=65432" \
    -p 5133:5133 \
    -p 65432:65432 \
    electricsql/electric:canary
```

This will start Electric and connect it to your Supabase database. Logs will be printed to the terminal allowing you to see any errors that may occur.

### 5. Verifying Electric initialisation

You can verify that Electric has initialised your database sucessfully using the Supabase dashboard. Select your project, then go to the "Table Editor" on the navigation menu. You should see a left-hand side menu listing any tables in your database with a "Schema" menu above.

Click this menu, and check that there is now an `electric` schema in your Postgres database. This confirms that the sync service has successfully initialised your database.

### 6. Electrifying tables

Electric works by [electrifying](../../usage/data-modelling/electrification.md) tables to opt them in to the Electric sync machinery. To do this, you will need to apply [DDLX statements](../../api/ddlx.md) via the Electric [migrations proxy](../../usage/data-modelling/migrations.md#migrations-proxy). Specifically, you need to:

1. connect to the Electric sync service using the `PG_PROXY_PORT` and the `PG_PROXY_PASSWORD` you configured above (either directly using psql, or by configuring the correct connection string for your migrations tooling)
2. then use the `ALTER TABLE <name> ENABLE ELECTRIC` syntax to electrify tables

For full details on how to run migrations see our [migrations documentation](../../usage/data-modelling/migrations.md). However, for example, to connect via psql to the sync service running on localhost:

```shell
PGPASSWORD=${PG_PROXY_PASSWORD} psql -U postgres -h localhost -p 65432 electric
```

You can then electrify tables, e.g.:

```shell
electric=# ALTER TABLE public.items ENABLE ELECTRIC;
ELECTRIC ENABLE
```

This will opt the `items` table in your public schema in to sync via Electric.

:::caution
Electric does not yet support permissions. Electrified tables are exposed to the public Internet.
:::

:::caution
Supabase has point-and-click tools for designing a database schema. This is a great way to get started when designing your data model.

However, ***once you have electrified a table***, you will need to apply any DDL schema changes to it via the same migrations proxy. This means that once you have electrified a table, you won't be able to update the schema of that table via the Supabase dashboard.
:::

## Using other Supabase tools with Electric

Supabase provides a suite of tools that pair well with Electric when building local-first apps, these include [Supabase Auth](#supabase-auth) and [Supabase Edge Functions](#supabase-edge-functions).

### Supabase Auth

[Supabase Auth](https://supabase.com/docs/guides/auth) works as an authentication solution for Electric. Authenticate using Supabase and then use the JWT returned by Supabase Auth as the [auth token for the Electric replication connection](../../usage/auth/token.md).

#### Authenticating users

Follow the instructions in the [Supabase Auth documentation](https://supabase.com/docs/guides/auth). Having authenticated a user, set the `session.access_token` returned by `supabase.auth.getSession()` as the value for `config.auth.token` when electrifying your database connection.

For example:

```ts
import { createClient } from '@supabase/supabase-js'
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'
import { schema } from './generated/client'

// Initiate your Supabase client
const supabaseUrl = import.meta.env.ELECTRIC_SUPABASE_URL
const anonKey = import.meta.env.ELECTRIC_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, anonKey)

// Construct the config for Electric using the user's JWT
const { data } = await supabase.auth.getSession()
const config = {
  auth: { 
    token: data.session.access_token
  },
  url: import.meta.env.ELECTRIC_URL,
}

// Initiate your Electric database
const conn = await ElectricDatabase.init('myApp.db', '')
const electric = await electrify(conn, schema, config)
```

You can see an example of this pattern in our [Checkout Example](https://github.com/electric-sql/electric/blob/main/examples/checkout/)

### Supabase Edge Functions

Many apps need to run code on the server when users take actions; a great way to do this with local-first apps built with Electric is using [event sourcing](../event-sourcing). Using a combination of a Postgres trigger and a [Supabase Edge Function](https://supabase.com/docs/guides/functions), you can run server side code when your database records are synced to the server. These triggers can run on various events within the database, such as inserting, updating and deleting rows in a database.

First, you need to ensure that the `pg_net` extension is enabled for your project - this is an extension that enables you to call an Edge Function url via SQL. In the dashboard go to "Database" -> "Extensions" and search for `pg_net`, and ensure it is toggled on.

To create an Edge Function for your app, follow the instructions in the [Supabase Auth documentation](https://supabase.com/docs/guides/functions).

Finally, you need to configure a trigger to call the Edge Function. Supabase has great documentation on [Postgres Triggers](https://supabase.com/docs/guides/database/postgres/triggers).

The "AFTER INSERT" trigger in the example below will be called whenever a new row in "my_table" is synced to the server. It then uses the `pg_net` extension to call an Edge Function at its URL. The Edge Function is passed a JSON body with the `id` of the new row inserted; it can use this to retrieve the row using the Supabase Client API and process it.

```sql
-- Drop any previous version of the trigger and function
DROP TRIGGER IF EXISTS "my_edge_function_trigger" ON "public"."my_table";
DROP FUNCTION IF EXISTS call_my_edge_function_trigger();

-- The function called by the trigger
CREATE FUNCTION call_my_edge_function_trigger() RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    'https://YOUR-SUPABASE-HOST.supabase.co/functions/v1/my_edge_function',
    ('{"id": "' || new.id || '"}')::jsonb,
    '{}'::jsonb,
    '{"Content-type":"application/json","Authorization":"YOUR-SERVICE-ROLL-KEY"}'::jsonb
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Configure the function to be called by an "AFTER INSERT" trigger
CREATE TRIGGER "my_edge_function_trigger" AFTER INSERT
ON "public"."my_table" FOR EACH ROW
EXECUTE FUNCTION call_my_edge_function_trigger();

-- This next line is required to ensure that triggers on the table are called
-- as a result of the Electric sync
ALTER TABLE "public"."my_table" ENABLE ALWAYS TRIGGER my_edge_function_trigger;
```

This code can either be run directly against your Postgres via the Supabase console, or you can include it in your database migrations.

You can see an example of this pattern in our [Checkout Example](https://github.com/electric-sql/electric/blob/main/examples/checkout/).
