# External-domain redirects — TODO

This document lists redirects that need to be configured at the **DNS / hosting layer** for the legacy product domains (`durablestreams.com` and `electric-agents.com`) once the Electric website restructure (2026-04) is live.

These redirects are **not** managed in `public/_redirects` because Netlify's `_redirects` file only handles redirects within `electric-sql.com`. Each external domain needs its own DNS record and a redirect rule in its hosting environment (Netlify, Cloudflare, Vercel, or wherever the domain is currently served from).

All redirects below should be permanent (`301`).

## `durablestreams.com` → `electric-sql.com/streams` and `/docs/streams/...`

Per-page mapping:

| Source | Target |
| --- | --- |
| `durablestreams.com/` | `https://electric-sql.com/streams` |
| `durablestreams.com/quickstart` | `https://electric-sql.com/docs/streams/quickstart` |
| `durablestreams.com/concepts` | `https://electric-sql.com/docs/streams/concepts` |
| `durablestreams.com/cli` | `https://electric-sql.com/docs/streams/cli` |
| `durablestreams.com/typescript-client` | `https://electric-sql.com/docs/streams/clients/typescript` |
| `durablestreams.com/python-client` | `https://electric-sql.com/docs/streams/clients/python` |
| `durablestreams.com/clients` | `https://electric-sql.com/docs/streams/clients/other` |
| `durablestreams.com/json-mode` | `https://electric-sql.com/docs/streams/json-mode` |
| `durablestreams.com/durable-proxy` | `https://electric-sql.com/docs/streams/durable-proxy` |
| `durablestreams.com/durable-state` | `https://electric-sql.com/docs/streams/durable-state` |
| `durablestreams.com/stream-db` | `https://electric-sql.com/docs/streams/stream-db` |
| `durablestreams.com/stream-fs` | `https://electric-sql.com/docs/streams/stream-fs` |
| `durablestreams.com/deployment` | `https://electric-sql.com/docs/streams/deployment` |
| `durablestreams.com/building-a-client` | `https://electric-sql.com/docs/streams/building-a-client` |
| `durablestreams.com/building-a-server` | `https://electric-sql.com/docs/streams/building-a-server` |
| `durablestreams.com/benchmarking` | `https://electric-sql.com/docs/streams/benchmarking` |
| `durablestreams.com/tanstack-ai` | `https://electric-sql.com/docs/streams/integrations/tanstack-ai` |
| `durablestreams.com/vercel-ai-sdk` | `https://electric-sql.com/docs/streams/integrations/vercel-ai-sdk` |
| `durablestreams.com/yjs` | `https://electric-sql.com/docs/streams/integrations/yjs` |
| `durablestreams.com/*` (catch-all) | `https://electric-sql.com/streams` |

## `electric-agents.com` → `electric-sql.com/agents` and `/docs/agents/...`

Per-page mapping:

| Source | Target |
| --- | --- |
| `electric-agents.com/` | `https://electric-sql.com/agents` |
| `electric-agents.com/docs/getting-started/about` | `https://electric-sql.com/docs/agents/about` |
| `electric-agents.com/docs/getting-started/quickstart` | `https://electric-sql.com/docs/agents/quickstart` |
| `electric-agents.com/docs/usage/*` | `https://electric-sql.com/docs/agents/usage/:splat` |
| `electric-agents.com/docs/reference/*` | `https://electric-sql.com/docs/agents/reference/:splat` |
| `electric-agents.com/docs/entities/*` | `https://electric-sql.com/docs/agents/entities/:splat` |
| `electric-agents.com/docs/examples/*` | `https://electric-sql.com/agents/demos` |
| `electric-agents.com/*` (catch-all) | `https://electric-sql.com/agents` |

## Notes

- All rules above are `301` permanent redirects.
- The catch-all rule must be the **last** rule for each domain so the more specific rules win.
- If the source domain is hosted on Netlify, these can go in that domain's own `_redirects` file. Otherwise, configure them in whatever hosting environment serves the domain (Cloudflare Page Rules, Vercel `vercel.json`, etc.).
- DNS for `durablestreams.com` and `electric-agents.com` should continue to resolve until all major links and search-engine references have updated.
