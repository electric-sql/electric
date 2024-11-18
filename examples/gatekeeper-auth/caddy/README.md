
# Caddy as authorising proxy

This folder contains example configuration (the [`./Caddyfile`](./Caddyfile)) to run the [Caddy](https://caddyserver.com) web server as a authorising proxy for Electric.

It uses the [ggicci/caddy-jwt](https://github.com/ggicci/caddy-jwt) module to validate and parse the shape definition out of a shape-scoped JWT auth token. It then uses Caddy's [request matchers](https://caddyserver.com/docs/caddyfile/matchers) to validate that the shape definition derived from the token matches the shape definition in the request.

## How to run

See the [2. Caddy as proxy](../README.md#2-caddy-as-proxy) section of the README in the root folder of this example.

## Locally without Docker

Alternatively, to run locally without Docker, you can open https://caddyserver.com/download?package=github.com%2Fggicci%2Fcaddy-jwt and click "Download" to download a pre-build Caddy binary for your environment with the `caddy-jwt` module installed.

Copy the binary to this folder and run with e.g.:

```shell
caddy run --config ./Caddyfile
```
