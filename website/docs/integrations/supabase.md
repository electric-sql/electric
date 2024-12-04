---
outline: deep
title: Supabase - Integrations
description: >-
  How to use Electric with Supabase. Including syncing data out of Supabase Postgres and into Supabase Edge Functions.
image: /img/integrations/electric-supabase.jpg
---

<img src="/img/integrations/supabase.svg" class="product-icon" />

# Supabase

[Supabase](https://supabase.com) is a Postgres hosting and backend-as-a-service platform for building web, mobile and AI applications.

## Electric and Supabase

You can use Electric on Supabase's [hosted Postgres](#deploy-postgres).

You can also use Electric to [sync data into Supabase Edge Functions](#sync-into-edge-function).

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Postgres

[Supabase Postgres databases](https://supabase.com/docs/guides/database/overview) come with logical replication enabled and the necessary permissions for Electric to work.

Create a database on [Supabase.com](https://supabase.com). Click the "Connect" button in the top right to get the connection string.

Make sure you untick the "Display connection pooler" option to get the direct access URL, because the pooled URL does not support logical replication. Note that this direct access URL only works with IPv6, which means you will need to [configure Electric to connect over IPv6](#troubleshooting-ipv6).

### Connect Electric

Configure Electric to connect to the direct access `DATABASE_URL` you copied above. Set [`ELECTRIC_DATABASE_USE_IPV6`](/docs/api/config#database-use-ipv6) to `true`, e.g.:

```shell
docker run -it \
    -e "DATABASE_URL=postgresql://postgres:[YOUR_PASSWORD]@db.[YOUR_PROJECT_ID].supabase.co:5432/postgres" \
    -e "ELECTRIC_DATABASE_USE_IPV6=true" \
    -p 3000:3000 \
    electricsql/electric:latest
```

#### Troubleshooting IPv6

When connecting to a Supabase Postgres, you either need to make sure Electric and its network supports IPv6, or you need to be on a Pro or Team plan with Supabase Platform to enable their IPv4 add-on. See the [troubleshooting guide on IPv6](/docs/guides/troubleshooting#ipv6-support) for tips on enabling IPv6 support for Electric. Or see [this Supabase guide](https://supabase.com/docs/guides/platform/ipv4-address#enabling-the-add-on) for information about enabling their IPv4 add-on.

> [!Tip] Need somewhere to host Electric?
> If you need to deploy Electric, then [Supabase works great](https://supabase.com/blog/postgres-on-fly-by-supabase) with [Fly.io](./fly#deploy-electric).


### Sync into Edge Function

You can also use Electric to sync data into a Supabase [Edge Function](https://supabase.com/docs/guides/functions).

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and follow the steps in [this Quickstart](https://supabase.com/docs/guides/functions/quickstart) to initialise a new project and create an edge function, e.g.:

```shell
supabase init
supabase functions new hello-electric
```

Start Supabase and serve the functions locally:

```shell
supabase start
supabase functions serve
```

Run `tail` to see the `curl` command at the bottom of the generated `supabase/functions/hello-electric/index.ts` file:

```shell
tail supabase/functions/hello-electric/index.ts
```

Copy the `curl` command (with the real value for `[YOUR_ANON_KEY]`) and run it once against the default function implementation:

```console
$ curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/hello-electric' \
    --header 'Authorization: Bearer [YOUR_ANON_KEY]' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'
...

{"message":"Hello Functions!"}
```

Now, replace the contents of `supabase/functions/hello-electric/index.ts` with the following, replacing `[YOUR_ELECTRIC_URL]` with the URL of an Electric service, running against a Postgres database with an `items` table. (This can be `http://localhost:3000` if you're running the local docker command we [used above](#connect-electric) when connecting Electric to Supabase Postgres).

```ts
import { Shape, ShapeStream } from 'npm:@electric-sql/client'

Deno.serve(async (req) => {
  const stream = new ShapeStream({
    url: '[YOUR_ELECTRIC_URL]/v1/shape',
    params: {
      table: 'items'
    }
  })
  const shape = new Shape(stream)
  const items = [...await shape.value]

  return new Response(
    JSON.stringify(items),
    { headers: { "Content-Type": "application/json" } },
  )
})
```

Save it, wait a second and then run the same `curl` command you just ran before to make a request to the edge function. You should see the data from your `items` table in the HTTP response, e.g.:

```console
$ curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/hello-electric' \
    --header 'Authorization: Bearer [YOUR_ANON_KEY]' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'
...

[["\"public\".\"items\"/\"69ad0c7c-7a84-48e8-84fc-d92e5bd5e2f4\"", ...]
```

## PGlite

Electric and Supabase are also collaborating to develop [PGlite](/product/pglite), which Supabase sponsor, contribute to and have developed [database.build](https://database.build) on.

<div style="max-width: 512px; margin: 24px 0">
  <div class="embed-container">
    <YoutubeEmbed video-id="ooWaPVvljlU" />
  </div>
</div>
