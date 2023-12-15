---
title: Supabase
description: >-
  Trigger background processing using Supabase Edge Functions.
sidebar_position: 50
---

# Supabase Edge Functions

[Supabase](../deployment/supabase.md) has native integration for event sourcing. This uses a combination of a Postgres triggers and [Supabase Edge Functions](https://supabase.com/docs/guides/functions).

Triggers can be setup to run on various events within the database, such as inserting, updating and deleting rows in a database. Supabase makes it easy to call a server-side edge function from a trigger.

## Setting up triggers with Edge Functions

First, you need to ensure that the `pg_net` extension is enabled for your project - this is an extension that enables you to call an Edge Function url via SQL. The steps are as follows:

1. in the Supabase Platform dashboard go to "Database" -> "Extensions", search for `pg_net`, and ensure it is toggled on
2. create an Edge Function, following the instructions in the [Supabase documentation](https://supabase.com/docs/guides/functions)
3. configure a trigger to call the Edge Function, following the [instructions here](https://supabase.com/docs/guides/database/postgres/triggers)

## Example

The example below uses an `AFTER INSERT` trigger, which will be called whenever a new row in `my_table` is created (both directly and when a new row created in the client is synced to the server).

The trigger then uses the `pg_net` extension to call an Edge Function by URL. The Edge Function is passed a JSON body with the `id` of the new row inserted. It then uses this to retrieve the row using the Supabase Client API and process it.

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

This code can either be run directly against your Postgres via the Supabase console, or you can include it in your [database migrations](../../usage/data-modelling/migrations.md).

You can see an example of this pattern in our [Checkout Example](../../examples/checkout.md).
