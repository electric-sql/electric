# API gatekeeper (and proxy) application

This is a [Phoenix](https://www.phoenixframework.org) web application written in [Elixir](https://elixir-lang.org).

See the [Implementation](../README.md#implementation) and [How to run](../README.md#how-to-run) sections of the README in the root folder of this example for more context about the application and instructions on how to run it using Docker Compose.

## Understanding the code

Take a look at [`./lib/api_web/router.ex`](./lib/api_web/router.ex) to see what's exposed and read through the [`./lib/api_web/plugs`](./lib/api_web/plugs) and [`./lib/api_web/authenticator.ex`](./lib/api_web/authenticator.ex) to see how auth is implemented and could be extended.

The gatekeeper endpoint is based on an [`Electric.Phoenix.Plug`](https://hexdocs.pm/electric_phoenix/Electric.Phoenix.Plug.html).

## Run/develop locally without Docker

See the [Phoenix Installation](https://hexdocs.pm/phoenix/installation.html) page for pre-reqs.

Install and setup the dependencies:

```shell
mix setup
```

Run the tests:

```shell
mix test
```

Run locally:

```shell
mix phx.server
```
