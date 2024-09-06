---
title: ElectricSQL v0.7 released
description: >-
  Version 0.7 of ElectricSQL. A local-first sync layer that you can use to build reactive, realtime, offline-capable apps directly on Postgres with your existing data model.
excerpt: >-
  We're thrilled to have published version 0.7 of ElectricSQL,
  which includes the new migration proxy and extended type support.
authors: [samwillis]
image: /img/blog/introducing-electric-sql/image.jpg
tags: [release]
outline: deep
post: true
---

> [!WARNING]
> This post describes a release of an old version of Electric that's no longer active. See the [Electric Next](/blog/2024/07/17/electric-next) post for context.

Here at Electric, we are thrilled to have published version 0.7 of ElectricSQL, which includes the new migration proxy and extended type support. This release lays the groundwork for many of the new features we are currently working on, and which will be available in future versions. Version 0.6, released in September, was the largest release of Electric since we began, and the culmination of six months of hard work;  you can read about the [previous release here](/blog/2023/09/20/introducing-electricsql-v0.6).

This new version builds on 0.6 by adding a number of key new features:

- Postgres Proxy
- Additional type support
- Improvements to the "starter"
- Support for Capacitor

You can learn more about these below.

## Postgres Proxy

A major new feature in Electric is the Postgres Proxy; this is a proxy provided by the Electric sync service, of use when applying migrations to your database. This first version of the proxy interprets our DDLX rules,  running the required operations on your database; it enables the  `ALTER TABLE issue ENABLE ELECTRIC;` syntax, and it is the precursor to having the full DDLX and permissions in future versions.

The proxy is also the starting point for addressing deployment to hosted Postgres providers with no superuser permissions. We still have a few things to address here, however this is the groundwork required to enable the solution in a future version.

When you apply any migrations to your Postgres you must remember to set the database url to the correct port (default 65432) on the Electric sync service.

You can read [more about the proxy in our documentation here](https://legacy.electric-sql.com/docs/usage/data-modelling/migrations#migration-proxy).

## Type Support

A large part of preparing for this version was improving our support for the various types available in Postgres. SQLite has a much more limited number of types available, therefore in order to bi-directionally sync between the two databases, these types need to be correctly encoded, decoded, and validated. Our data access library translates these to and from the correct javascript type.

- Time and date types (`time`, `timestamp`, `timestamptz`, and `date`)<br />
  These are stored in SQLite as ISO 8601 strings, and converted to and from javascript `Date` objects.
- `boolean`<br />
  SQLite does not have a boolean type, using `int`s to represent them. These are now correctly translated to JavaScript bools.
- `uuid`<br />
  UUIDs are now represented as strings in SQLite and JavaScript, and the DAL validates they are correct.
- `int2` and `int4`<br />
  These are stored as `int`s in SQLite and validated to be within the correct range.
- `float8`<br />
  These are now correctly stored as `REAL` in SQLite, with support for `+inf/-inf`. The only caveat is that `NaN` is stored in string form due to a limitation in a number of SQLite drivers that convert `NaN` to `null`, breaking the distinction between the two.

You can read [more about type support in our documentation here](https://legacy.electric-sql.com/docs/usage/data-modelling/types).

## "Starter" improvements

We have updated our `npx create-electric-app@latest` starter to enable building apps using the latest version of Electric, and to support the new proxy. We have also added support for multiple migrations in the `db/migrations` directory using [@databases/pg-migrations](https://www.atdatabases.org/docs/pg-migrations), see its documentation on how to use.

## Capacitor support

Community member [Gregorio Zanon](https://twitter.com/realgregzo) created a Capacitor driver, wrapping capacitor-community/sqlite; this enables a developer to use Electric for building mobile apps on iOS and Android using native SQLite.

You can read [more about our Capacitor support in this post here](/blog/2023/11/02/using-electricsql-with-the-ionic-framework-and-capacitor).

For a full list of updated components see [Release notes](https://legacy.electric-sql.com/docs/reference/release_notes#2023-11-02---v07).
