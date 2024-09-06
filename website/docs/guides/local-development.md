---
outline: deep
---

# Local Development

## Why are my shapes loading so slow in the browser?

The most frequent issue people encounter with local development with Electric
is a mysterious slow-down when your web app is subscribed to 6+ shapes.

This slow-down is due to a limitation of the legacy version of HTTP, 1.1.
Browsers only allow 6 simultaneous requests to a specific backend as each
HTTP/1.1 request uses its own expensive TCP connection. As shapes are loaded over HTTP,
this means only 6 shapes can be getting updates with HTTP/1.1 due to the this
browser restriction. All other requests pause until there's an opening.

HTTP/2, introduced in 2015, fixes this problem by _multiplexing_ each request
to a server over the same TCP connection. This allows essentially unlimited
connections.

HTTP/2 is standard across the vast majority of hosts now. Unfortunately it's
not yet standard in local dev environments.

To fix this, we'll setup a local reverse-proxy using the very popular [Caddy
server](https://caddyserver.com/).

It automatically sets up HTTP/2 and proxies requests back to Electric getting around
the 6 requests HTTP/1.1 limitation in the browser.

### Run Caddy
This command runs Caddy so it's listening on port 3001 and proxying shape
requests to Electric which listens on port 3000. If you're loading shapes
through your API or framework dev server, replaces 3000 with the port your API
or dev server is listening on.

```shell
npx @radically-straightforward/caddy run --config - --adapter caddyfile <<EOF
:3001 {
  reverse_proxy localhost:3000
  encode {
    gzip
  }
}
EOF
```

Now change your shape URLs to use port 3001 instead of port 3000 and you're done!
