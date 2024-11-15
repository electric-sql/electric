
# Gatekeeper client

This is a little client app that syncs a shape from Electric using the gatekeeper pattern.

I.e.: if first fetches config, including an auth token, from the gatekeeper. Then it uses the config to connect to Electric via the authorizing proxy.

Note that it will use whichever proxy the API is configured to use (by connecting to the proxy using the url in the gatekeeper response).

## Run locally

```shell
npx tsx index.ts
```
