---
'@electric-ax/agents-runtime': patch
---

The built-in `fetch_url` tool now refuses URLs whose host resolves to a private, loopback, link-local, or cloud-metadata IP. Literal IPs in those ranges (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, IPv6 `::1`, `fe80::/10`, `fc00::/7`) are rejected before any network call. Hostnames are resolved via `dns.lookup({ all: true })` and rejected if *any* returned address is private (defense-in-depth against a partial-private response).

**Breaking:** any current usage that points `fetch_url` at `localhost`, an internal LAN host, or a metadata endpoint stops working. Mitigation: pass `allowedHosts: ['localhost', '127.0.0.1', ...]` to `createFetchUrlTool` for trusted internal hostnames. The desktop app needs this update for any developer who fetches localhost via Horton; the desktop wiring is unchanged in this PR.

**Known gap:** DNS rebinding — a second resolution between this check and the socket connect can return a different IP. Fixing this requires a custom undici dispatcher that pins to the resolved address; out of scope here.
