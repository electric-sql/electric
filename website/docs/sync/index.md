---
title: Sync
description: >-
  Documentation for Electric Sync — the read-path sync engine for Postgres, syncing data into local clients over HTTP.
outline: deep
---

# Sync

Electric Sync is a read-path sync engine for Postgres. It syncs data out of Postgres into local clients over HTTP using a primitive called a [Shape](/docs/sync/guides/shapes).

## Get started

- [Introduction](/docs/sync/intro) — what Electric Sync is and how it fits together.
- [Quickstart](/docs/sync/quickstart) — get a sync running end-to-end in a few minutes.
- [Stacks](/docs/sync/stacks) — recommended stacks for building local-first apps with Electric.

## Guides

- [Shapes](/docs/sync/guides/shapes) — defining what gets synced.
- [Auth](/docs/sync/guides/auth) — securing access to your shapes.
- [Writes](/docs/sync/guides/writes) — patterns for writing data back through your API.
- [Deployment](/docs/sync/guides/deployment) — how to self-host Electric.
- [Security](/docs/sync/guides/security) — securing your Electric deployment.
- [Client development](/docs/sync/guides/client-development) — building your own client library.

## Reference

- [HTTP API](/docs/sync/api/http) — the protocol that clients consume.
- [TypeScript client](/docs/sync/api/clients/typescript) — the official client library.
- [Configuration](/docs/sync/api/config) — server configuration options.
- [Integrations](/docs/sync/integrations/react) — framework, platform, and database integrations.

## See also

- [PGlite](/sync/pglite) — embeddable Postgres for the browser, Node.js, and edge.
