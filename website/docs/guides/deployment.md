---
title: Deployment - Guide
description: >-
  Considerations to take into account when deploying Electric.
outline: deep
---

# Deployment

This page is under construction.

Below you'll find basic information about where Electric keeps persistent state that is necessary for it to work correctly and to resume syncing after a restart of the sync service.

## Data persistence

### Postgres

When running, Electric keeps a pool of active database connections for processing new shape requests and for streaming transactions from Postgres to shape consumers in realtime. It creates a replication slot and a publication inside the Postgres database configured via `DATABASE_URL`, the two of which ensure continuous replication of changes even in the face of restarts of the sync service or Postgres.

If you decide to stop using Electric with a given Postgres database or switch to a different database but keep the old one around, make sure to clean up both the publication and the replication slot. See this [troubleshooting advice](./troubleshooting#wal-growth-mdash-why-is-my-postgres-database-storage-filling-up) for details.

### Shape data storage

Electric uses persistent storage outside of Postgres to store shape metadata and [shape logs](/docs/api/http#shape-log). By default, it creates a directory named `persistent` in the currrent working directory where it's running. This is fine for development, but not suitable for a production setup.

The path to Electric's persistent storage can be configured via the `STORAGE_DIR` environment variable, e.g. `STORAGE_DIR=/var/lib/electric/persistent`. Electric will create the directory at that path if it doesn't exist yet but you need to make sure that the OS user that it's running as has the necessary permissions in the parent directory.

Naturally, the file system location configured via `STORAGE_DIR` and the data Electric stores there must survive sync service's restarts. When using Docker as the runtime environment, you can create a volume and use a path inside it as `STORAGE_DIR`. When using Kubernetes, you'll want to create a persistent volume and attach it to your Electric deployment.

### Maintaining shape consistency

To ensure consistent syncing of a subset of data from Postgres to a shape consumer, Electric needs to look at every single transaction committed in Postgres that touches any of the tables included in its active shapes. That's the reason for creating a publication, instructing Postgres to start replicating operations on specified tables, and a replication slot, instructing Postgres to hold on to WAL files until Electric processes all transactions contained in them.

The persistent state that Electric maintains in Postgres must stay in sync with the shape data stored on disk, outside of the database cluster. If you change the value of `STORAGE_DIR` or switch to a different `DATABASE_URL` at any point, you must clean up the other location by hand, whether it's removing a directory tree on disk or dropping the replication slot and publication in Postgres.
