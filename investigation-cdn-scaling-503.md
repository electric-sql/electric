# Investigation: 503 "overloaded" at ~200 Clients (Superset)

## Context

User running Electric v1.4.3 (client v1.5.2) with:
- ~200 DAU, ~13 collections
- 4 CPU cores / 8GB memory
- ~1.7k RPS (mostly 503s)
- Self-hosted, no CDN
- Next.js API route proxy → Electric

Example failing URL:
```
https://api.superset.sh/api/electric/v1/shape?cursor=42523920&live=true&log=full&offset=15468417488_0&organizationId=...&table=tasks
```

Error: `{"code":"overloaded","message":"Server is currently overloaded, please retry"}`

## Root Cause

### Admission Control Limit Exceeded

Electric has an admission control system (`packages/sync-service/lib/electric/admission_control.ex`)
that limits concurrent requests. Default limits from `packages/sync-service/lib/electric/config.ex:71`:

```elixir
max_concurrent_requests: %{initial: 300, existing: 1000}
```

Each `live=true` long-poll request **holds an admission control permit for the entire
long-poll duration** (up to 20 seconds, configured via `long_poll_timeout: 20_000`).
The permit is acquired in `check_admission/2` in `serve_shape_plug.ex:144` and released
via `register_before_send` only when the response is sent.

### The Math

- 200 clients × 10-13 collections = **2,000-2,600 concurrent long-poll connections**
- Default limit for existing requests: **1,000**
- Result: ~1,000 connections succeed, ~1,600 get 503'd
- 503'd clients retry with 5-10s jitter → **perpetual thundering herd**

This explains why:
- The machine "seems healthy" (CPU/memory fine) — admission control is an application-level
  counter, not a system resource check
- The 1.7k RPS is mostly retry storms from 503'd clients
- The problem persists even after scaling up hardware

## Why CDN Request Collapsing Solves This

Electric's caching strategy is designed for CDN request collapsing:

| Request Type | Cache-Control | Purpose |
|---|---|---|
| Initial sync (offset=-1) | `public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746` | Long-lived CDN cache |
| Catch-up (live=false) | `public, max-age=60, stale-while-revalidate=300` | Medium cache |
| Live long-poll (live=true) | `public, max-age=5, stale-while-revalidate=5` | Short cache for request collapsing |
| Errors | `no-store` + `surrogate-control: no-store` | Never cached |

With a CDN using **request collapsing** (e.g., Nginx `proxy_cache_lock on`, Cloudflare default
behavior), when 50 users in the same org poll the `tasks` shape at the same offset:
- CDN queues 49 of them
- Sends **1** request to Electric
- Fans the response out to all 50

This would reduce Electric's concurrent connections from ~2,600 to perhaps ~100-200
(one per unique shape+offset combination per cache miss window).

## Proxy Bug: `Vary: Authorization` Defeats CDN Caching

The user's proxy adds `Vary: Authorization` to responses. This tells CDNs to cache
responses separately for every unique Authorization header value. Since every user has a
unique bearer token, this **completely prevents request collapsing across users**.

The fix: Remove `Vary: Authorization`. Auth validation happens at the proxy layer before
requests reach Electric/CDN. The CDN cache key should be based on URL path + query params
(which already include `organizationId`, `table`, `offset`, etc.), not the auth token.

## Recommended Fixes (Priority Order)

### 1. Add CDN with Request Collapsing (Biggest Impact)

Place Cloudflare, CloudFront, or Nginx between the proxy and Electric.

Example Nginx configuration (based on `packages/sync-service/dev/nginx.conf`):
```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=electric:10m max_size=1g
    inactive=60m use_temp_path=off;

location /v1/shape {
    proxy_cache electric;
    proxy_cache_lock on;              # Request collapsing
    proxy_cache_revalidate on;
    proxy_cache_use_stale error timeout;
    proxy_cache_background_update on;
    proxy_cache_min_uses 1;
    proxy_pass http://electric:3000;
}
```

### 2. Remove `Vary: Authorization` from Proxy Response

Without this fix, even with a CDN, every request is treated as unique.

### 3. Increase `max_concurrent_requests` as Stopgap

```bash
ELECTRIC_MAX_CONCURRENT_REQUESTS='{"initial": 500, "existing": 3000}'
```

Their 4-core/8GB instance can handle 3,000 concurrent Erlang processes in `receive` —
these are lightweight. This buys time but doesn't solve the underlying scaling issue.

### 4. Consider Electric Cloud

Handles CDN, scaling, and operations out of the box.

### 5. Lazy-Load Collections

Their `preloadCollections()` eagerly starts all 10-13 collections on app boot.
Lazy-loading collections per screen would reduce concurrent connections per client.

## Key Files Referenced

- `packages/sync-service/lib/electric/admission_control.ex` — Permit management
- `packages/sync-service/lib/electric/plug/serve_shape_plug.ex:144-201` — Admission check + 503 response
- `packages/sync-service/lib/electric/config.ex:71` — Default limits
- `packages/sync-service/lib/electric/shapes/api.ex:747` — `hold_until_change` long-poll
- `packages/sync-service/lib/electric/shapes/api/response.ex` — Cache header strategy
- `packages/sync-service/dev/nginx.conf` — Reference CDN/proxy config
