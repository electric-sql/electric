---
title: Supabase
description: >-
  An open source Firebase alternative built on Postgres.
sidebar_position: 55
---

ElectricSQL supports connecting to a hosted Postgres provided by [Supabase](https://supabase.com), an open source Firebase alternative that also provides many other tools, including Authentication and Edge Functions. All Supabase Postgres instances already have logical replication enabled, so connecting is super easy.

Supabase does not provide hosting for the [Electric sync service](../../api/service.md) itself, so you will want to run it close to the region your Supabase Postgres is located in. We have a [list of deployment options here](../deployment/).


:::info
Supabase support for Electric is currently only enabled in the Canary build, available as the `electricsql/electric:canary` docker image.
:::

## How to connect Electric to Supabase Postgres

1. [Setting up a Supabase Postgres](#setting-up-a-supabase-postgres)
2. [Retrieving the connection details from the Supabase dashboard](#retrieving-the-connection-details)
3. [Configuring Electric to connect to Supabase](#configuring-electric-to-connect-to-supabase)
4. [Running a local Electric Docker and connecting it to Supabase](#running-a-local-electric-docker-connected-to-supabase)
5. [Verifying that Electric has successfully connected to your Supabase Postgres](#verifying-that-electric-has-successfully-connected)
6. [Running schema migrations on your database](#running-schema-migrations-on-your-database)

### 1. Setting up a Supabase Postgres

First, if you don't yet have a Supabase account visit [supabase.com](https://supabase.com) and create one.

Creating a Postgres database with Supabase is easy. First, log in to the dashboard and click "New Project". In the form enter a name for the database, and a password that will be used to connect to it. Make a note of this password as you will need it when connecting Electric to Supabase.

You will also need to select a region for you database to be hosted in. It's recommended to host both your Postgres and Electric sync service in the same region if possible to reduce latency.

### 2. Retrieving the connection details

You can retrieve the connection details for your database by going to "Project Settings" > "Database" in the Supabase dashboard. The top of the screen will list the `host`, `database name`, `port`, and `user` for your Postgres database. Your password for the database will have been set when you created the project. Use this to construct your `DATABASE_URL` in the form of:

```
postgresql://user-name:password@db.your-host.supabase.co:port/database-name
```

:::caution
Do not use the "Connection Pool" connection string a little further down the screen that Supabase provides for your database, as this will prevent the sync service from operating. 
:::

### 3. Configuring Electric to connect to Supabase

Next, we configure Electric to connect to Supabase. The [Electric sync service](../../api/service) is available as either a Docker image or Elixir app, and it uses environment variables for configuration.

You must configure Electric to use the `direct_writes` mode for inbound transactions, as Supabase does not support the default inbound `logical_replication` mode. This is configured with the `ELECTRIC_INBOUND_MODE` environment variable.

Along with the other [configuration options](../../api/service.md#configuration-options), these details will result in an environment configuration for Electric, similar to:

```bash
DATABASE_URL=postgresql://user-name:password@db.your-host.supabase.co:port/database-name
ELECTRIC_INBOUND_MODE=direct_writes
PG_PROXY_PASSWORD=...
AUTH_JWT_ALG=HS512
AUTH_JWT_KEY=...
```

Depending on how you run Electric these could be passed as arguments to Docker, set in a ENV file or entered into a managed host's dashboard.

### 4. Running a local Electric Docker connected to Supabase

To run a local Electric Docker and connect it to your Supabase Postgres you can run the following command.

```bash
docker run \
    -e "DATABASE_URL=postgresql://user-name:password@db.your-host.supabase.co:port/database-name" \
    -e "ELECTRIC_INBOUND_MODE=direct_writes" \
    -e "PG_PROXY_PASSWORD=my-pg-password" \
    -e "AUTH_MODE=insecure" \
    -p 5133:5133 \
    -p 65432:65432 \
    electricsql/electric:canary
```

This will start Electric in [insecure mode](../../api/service.md#authentication) and connect it to your database, which is perfect for local development. The logs will be printed to the terminal allowing you to see any errors that may occur.

### 5. Verifying that Electric has successfully connected

Once you have the sync service running, it's time to verify that it has successfully connected to Supabase. The easiest way to do this is via the Supabase dashboard.

First select your project, then go to the "Table Editor" on the navigation menu. You should see a left-hand side menu listing any tables in your database with a "Schema" menu above. Click this menu, and check that there is now an "Electric" schema in your Postgres database, as this will confirm that the sync service has successfully connected and initiated itself.

### 6. Running schema migrations on your database

Supabase has point-and-click tools for designing a database schema, which is a great way to get started with designing your database. However, in order to "Electrify" your tables, you will need to do this via the [Electric Migration Proxy](../../usage/data-modelling/migrations.md#migrations-proxy) which is built into the sync service.

For details on how to run migrations see our [migrations documentation](../../usage/data-modelling/migrations.md).

:::caution
It's important not to make schema changes to your database via the Supabase dashboard after a table has been "Electrified" as these changes will not be tracked by Electric and propagated to client databases.
:::

## Using other Supabase tools with Electric

Supabase provide a suite of tools that pair well with Electric when building local-first apps, these include [Supabase Auth](#supabase-auth) and [Supabase Edge Functions](#supabase-edge-functions).

### Supabase Auth

[Supabase Auth](https://supabase.com/docs/guides/auth) is the perfect partner for authenticating users with Electric when using Supabase as your Postgres. It's super easy to set up: all you need to do is share the JWT key used for Supabase with Electric.

To find your JWT key, go to the Supabase dashboard for your project, select "Project Settings", then "API", and scroll down to the JWT settings. Copy the "JWT Secret" and use that as the `AUTH_JWT_KEY` for your Electric configuration as well as settings `AUTH_JWT_ALG: HS256`.

To authenticate your users in your app, follow the instructions in the [Supabase Auth documentation](https://supabase.com/docs/guides/auth). You should authenticate your users before initiating Electric within your app.

Having authenticated a user, you can use the following code to use their JWT to authenticate with the Electric service and 'Electrify' your database:

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

You can see an example of this pattern in our [Checkout Example](https://github.com/electric-sql/electric/blob/main/examples/checkout/)
