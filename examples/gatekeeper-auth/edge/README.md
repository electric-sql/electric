
# Edge function as an authorising proxy

This folder contains example edge function ([`./index.ts`](./index.ts)) which you can run as a authorising proxy for Electric.

It uses the [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) NPM package to validate and parse the shape definition out of a shape-scoped JWT auth token. It then uses standard Javascript functions to validate that the shape definition derived from the token matches the shape definition in the request parameters.

## How to run

See the [3. Edge function as proxy](../README.md#2-edge-function-as-proxy) section of the README in the root folder of this example to run using Docker.

### Locally without Docker

It's just a [Deno server](https://docs.deno.com/runtime/fundamentals/http_server/). Make sure you have [Deno installed](https://docs.deno.com/runtime/getting_started/installation/) and then run:

```shell
deno run --allow-env --allow-net index.ts
```

### As a Supabase Edge Function

One of the key things about using an edge function as an authorising proxy is that it can run close to your users, in front of a CDN. This example is designed to match the code you would deploy to a [Supabase Edge Function](https://supabase.com/docs/guides/functions).

Follow their [Quickstart guide](https://supabase.com/docs/guides/functions/quickstart) for instructions and their docs on [setting secrets](https://supabase.com/docs/guides/functions/secrets) as environment variables.

In short you run:

```shell
supabase init
supabase functions new $YOUR_FUNCTION_NAME
```

Copy `./index.ts` and `./deno.json` into the `./supabase/functions/$YOUR_FUNCTION_NAME` folder. You can then run locally with:

```shell
supabase start
supabase functions server
```

And then hit it at `http://localhost:54321/functions/v1/$YOUR_FUNCTION_NAME`, e.g.:

```shell
export FUNCTION_URL="http://localhost:54321/functions/v1/${YOUR_FUNCTION_NAME}"

curl -sv --header "Authorization: Bearer ${AUTH_TOKEN}" \
    "${FUNCTION_URL}/v1/shape?table=items&offset=-1"
...
< HTTP/1.1 200 OK
...
```

To deploy, you login using

```shell
supabase login
```

Link a project using:

```shell
supabase link --project-ref $YOUR_PROJECT_ID
```

Deploy using the `--no-verify-jwt` flag to disable Supabase's built-in JWT validation:

```shell
supabase functions deploy --no-verify-jwt
```

Set your env vars using `supabase secrets set`:

```shell
# ngrok http 3000
supabase secrets set ELECTRIC_URL=https://example.ngrok.app
```

Hit the deployed function at `https://$YOUR_PROJECT_ID.supabase.co/functions/v1/$YOUR_FUNCTION_NAME`:

```shell
export FUNCTION_URL="https://${YOUR_PROJECT_ID}.supabase.co/functions/v1/${YOUR_FUNCTION_NAME}"

curl -sv --header "Authorization: Bearer ${AUTH_TOKEN}" \
    "${FUNCTION_URL}/v1/shape?table=items&offset=-1"
...
< HTTP/1.1 200 OK
...
```