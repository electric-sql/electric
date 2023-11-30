---
title: Supabase
description: >-
  An open source Firebase alternative built on Postgres.
sidebar_position: 30
---

ElectricSQL supports connecting to a hosted Postgres provided by [Supabase](https://supabase.com), an open source Firebase alternative that also provides many other tools, including Authentication and Edge Functions. All Supabase Postgres instances already have logical replication enabled, and so connecting is super easy.

### Deploying Electric with Supabase

:::info
Supabase support for Electric is currently only enabled in the canary build, available as the `electricsql/electric:canary` docker image.
:::

First, retrieve the connection details for your database by going to "Project Settings" > "Database". The top of the screen will list the host, database name, port, and user for your Postgres database. Your password for the database will have been set when you created the project. Use this to construct your `DATABASE_URL` in for the form:

```
postgresql://user-name:password@db.your-host.supabase.co:port/database-name
```

Next, you must configure Electric to use the `direct_writes` mode for inbound transactions, as Supabase does not support the default inbound `logical_replication` mode. This is configured with the `ELECTRIC_INBOUND_MODE` environment variable.

These details will result in an environment configuration for Electric, similar to:

```bash
DATABASE_URL=postgresql://user-name:password@db.your-host.supabase.co:port/database-name
ELECTRIC_INBOUND_MODE=direct_writes
LOGICAL_PUBLISHER_HOST=...
PG_PROXY_PASSWORD=...
AUTH_JWT_ALG=HS512
AUTH_JWT_KEY=...
```

An example invocation of the Docker image would be:

```bash
docker run \
    -e "DATABASE_URL=postgresql://user-name:password@db.your-host.supabase.co:port/database-name" \
    -e "ELECTRIC_INBOUND_MODE=direct_writes" \
    -e "LOGICAL_PUBLISHER_HOST=..." \
    -e "PG_PROXY_PASSWORD=..." \
    -e "AUTH_JWT_ALG=HS512" \
    -e "AUTH_JWT_KEY=..." \
    -p 5133:5133 \
    -p 5433:5433 \
    -p 65432:65432 \
    electricsql/electric:canary
```

See the [full configuration options](../../api/service.md#configuration-options) for more details.

:::caution
Do not use the "Connection Pool" connection string that Supabase provides for your database, as this will prevent the sync service from operating. 
:::

### Using Supabase Auth with Electric

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

### Using Supabase Edge Functions with Electric

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
