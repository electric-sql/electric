---
title: ElectricSQL v0.8 released with JSON and Supabase support
description: >-
  Version 0.8 of ElectricSQL. A local-first sync layer that you can use to build reactive, realtime, offline-capable apps directly on Postgres with your existing data model.
excerpt: >-
  Version 0.8 of ElectricSQL has now been released. This release improves data model and deployment compatibility, including support for JSON and running on popular managed Postgres and, such as Supabase and Digital Ocean.
authors: [samwillis]
image: /img/blog/electricsql-v0.8-released/Electric+Supabase.png
tags: [release]
outline: deep
post: true
---

Version 0.8 of ElectricSQL has now been released. This release improves data model and deployment compatibility, [including support for JSON](/blog/2023/12/13/electricsql-v0.8-released#additional-type-support-including-json) and [running on popular managed Postgres](/blog/2023/12/13/electricsql-v0.8-released#from-superuser-to-supabase) and [application hosts](/blog/2023/12/13/electricsql-v0.8-released#the-proxy-tunnel), such as Supabase and Digital Ocean.

## Additional Type Support including JSON

This release brings a [wider range of supported Postgres types](/docs/usage/data-modelling/types#supported-data-types):

- Electric now supports JSON with Postgres `JSONB` columns - When using our DAL, javascript objects are automatically serialised to JSON when inserted into a JSON column, and, in reverse, converted back to an object when loading from the database.As the client is backed by a local SQLite database you can use all of SQLite’s JSON function to query and modify JSON within the database.
- Support for `BIGINT`/`INT8` and `REAL`/`FLOAT` Postgres types

## From Superuser to Supabase

Previously, Electric has needed to connect to your Postgres with superuser permissions. This level of permission is not always available. This limited the Postgres hosts that you could use Electric with. This release removes this limitation, so you can now run Electric without superuser.

The groundwork for removing the need for superuser was laid in [version 0.7](/blog/2023/11/02/electricsql-v0.7-released), with the [new migrations proxy](/docs/usage/data-modelling/migrations#migrations-proxy). This release builds on this with a [new "direct writes" mode](/docs/api/service#write-to-pg-mode) of writing data from Electric into Postgres. This new mode does not require elevated privileges.

One of the key platforms that this unlocks compatibility with is Supabase. Supabase provides hosted Postgres with a suite of backend-as-a-service and AI tools. With this release, Electric now works out of the box with the managed [Supabase Platform](https://supabase.com) offering, as well as open source, self-host Supabase.

We have published [details on how to use Electric with Supabase](/docs/deployment/supabase), and there are updated [deployment instructions for additional platforms](/docs/deployment).

There is also have a great new [Checkout Example](/docs/examples/checkout) app showing how to build a local-first checkout flow with Electric, using Supabase Postgres, Edge Functions and Auth.

## The Proxy Tunnel

Many PaaS providers, such as Heroku and Digital Ocean App Platform, only enable you to expose one public port from your Docker container or service. As Electric exposes both a HTTP port for the client synchronisation connections, as well as a TCP port for connecting to the Postgres Proxy, this has made deploying to these platforms difficult.

With the release of v0.8 we now have a [mode where you can tunnel the Postgres Proxy TCP connection over a web socket](/docs/api/cli#proxy-tunnel) to a local port. This enables the generator command, migrations, and connecting to the proxy with psql, to work without direct access to the Migration Proxy.

You can see a nice example of this on the new [Digital Ocean deployment docs](https://electric-sql.com/docs/deployment/digital-ocean).

## Other changes

There are many other improvements in this release:

- Improved support for running Electric and the Node based dev tools on Windows.
- The Electric sync service now listens on both IPv6 and IPv4 by default.
- You can now use any version of Prisma for your app.
- Prisma and the `@electric-sql/prisma-generator` package can be removed as dependencies from your project.

For a full list of updated components see [Release notes](/docs/reference/release_notes#2023-12-13---v08).
