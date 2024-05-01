---
title: Release notes
description: >-
  Abridged log of Electric releases with compatibility notes.
---

ElectricSQL is in <strong className="warning-color">public alpha</strong> phase.

APIs are not guaranteed to be stable. Backwards incompatible changes may (and will) be introduced in patch, minor and major version releases.

This page provides an overview of major releases as well as minor- and patch-level releases that may cause compatibility issues for user apps. Such potentially problematic changes are highlighted in *Compatibility notes* sections for every release that includes those.

To learn more about the major feature releases of Electric, see release announcement posts [on our blog](/blog/tags/release).

To see the complete change log for each new release, see the [Releases page](https://github.com/electric-sql/electric/releases) on GitHub or the `CHANGELOG.md` file of each individual component:

- [Sync service](https://github.com/electric-sql/electric/blob/main/components/electric/CHANGELOG.md)
- [TypeScript client](https://github.com/electric-sql/electric/blob/main/clients/typescript/CHANGELOG.md)
- [create-electric-app](https://github.com/electric-sql/electric/blob/main/examples/starter/CHANGELOG.md)
- [@electric-sql/prisma-generator](https://github.com/electric-sql/electric/blob/main/generator/CHANGELOG.md)


## 2024-05-02 - v0.10.2

```
[Announcement post](/blog/2024/05/02/electricsql-v0.11-released).
```

This release introduces a new database driver for PGLite. Plus reliability improvements.

#### Updated components

Component | Version
--------- | -------
[Sync service][1] | [0.10.2](https://github.com/electric-sql/electric/blob/main/components/electric/CHANGELOG.md#0102)
[TypeScript client][2] | [0.10.2](https://github.com/electric-sql/electric/blob/main/clients/typescript/CHANGELOG.md#0102)
[create-electric-app][3] | [0.3.1](https://github.com/electric-sql/electric/blob/main/examples/starter/CHANGELOG.md#031)

#### Compatibility notes

**Sync service**

- The default value for `DATABASE_USE_IPV6` is now `false` due to immaturity of IPv6 support at multiple levels of the Internet infrastucture.

## 2024-04-10 - v0.10

[Announcement post](/blog/2024/04/10/electricsql-v0.10-released).

The first release to support where-clause and include-tree filtering with Shape-based sync. It also adds data type support for byte arrays / blobs.

#### Updated components

Component | Version
--------- | -------
[Sync service][1] | [0.10.0](https://github.com/electric-sql/electric/blob/main/components/electric/CHANGELOG.md#0100)
[TypeScript client][2] | [0.10.0](https://github.com/electric-sql/electric/blob/main/clients/typescript/CHANGELOG.md#0100)
[@electric-sql/prisma-generator][4] | [1.1.4](https://github.com/electric-sql/electric/blob/main/generator/CHANGELOG.md#114)

#### Compatibility notes

This release does not introduce any noteable breaking changes.

## 2024-03-14 - patch release

#### Updated components

Component | Version
--------- | -------
[Sync service][1] | [0.9.4](https://github.com/electric-sql/electric/blob/main/components/electric/CHANGELOG.md#094)
[TypeScript client][2] | [0.9.5](https://github.com/electric-sql/electric/blob/main/clients/typescript/CHANGELOG.md#095)

#### Compatibility notes

**TypeScript client**

- The `react-native-get-random-values` package is no longer included as a dependency of the client. It is up to the developer to add it as a dependency to their app to use a better random number generator for UUIDs generated on the client.
- The `cordova-sqlite-storage` driver support has been removed.
- The `react-native-sqlite-storage` driver support has been removed, replaced by the `op-sqlite` driver which is a better tested and more mature option for using SQLite with React Native.
- The minimum required version for the `@capacitor-community/sqlite` driver has been bumped.

## 2024-02-22 - patch release

#### Updated components

Component | Version
--------- | -------
[Sync service][1] | [0.9.3](https://github.com/electric-sql/electric/blob/main/components/electric/CHANGELOG.md#093)
[TypeScript client][2] | [0.9.4](https://github.com/electric-sql/electric/blob/main/clients/typescript/CHANGELOG.md#094)
[create-electric-app][3] | [0.2.8](https://github.com/electric-sql/electric/blob/main/examples/starter/CHANGELOG.md#028)

#### Compatibility notes

**Sync service**

- A change in the internal representation of electrified tables with columns of enum types may cause issues with SQL schemas that have such tables. Reset the database to resolve these issues.
- Electric now refuses to start if any of the secure auth settings are used with `AUTH_MODE=insecure`.
- Electrification of tables outside of the public schema is now rejected.
- Electric now performs SSL certificate validation for database connections with `DATABASE_REQUIRE_SSL=true` (the default).
- When `AUTH_MODE=secure` and one of the `HS*` signature validation algorithms is configured, Electric will now try to detect if the value of `AUTH_JWT_KEY` is base64-encoded and will decode it automatically.

**TypeScript client**

- Connecting to the sync service has been detached from the electrification of a database connection. You now have to call `electric.connect()` as a separate step. See <DocPageLink path="api/clients/typescript#instantiation" /> for details.
- The `connectivityState` of the client is now read-only. A separate `disconnect()` method has been introduced to disconnect the client from the sync service.

## 2024-01-24 - v0.9

[Announcement post](/blog/2024/01/24/electricsql-v0.9-released).

This release introduces a whole new client CLI, experimental support for enum types, configuration improvements for the sync service and more.

#### Updated components

Component | Version
--------- | -------
[Sync service][1] | [0.9.1](https://github.com/electric-sql/electric/blob/main/components/electric/CHANGELOG.md#091)
[TypeScript client][2] | [0.9.1](https://github.com/electric-sql/electric/blob/main/clients/typescript/CHANGELOG.md#091)
[create-electric-app][3] | [0.2.5](https://github.com/electric-sql/electric/blob/main/examples/starter/CHANGELOG.md#025)
[@electric-sql/prisma-generator][4] | [1.1.3](https://github.com/electric-sql/electric/blob/main/generator/CHANGELOG.md#113)

#### Compatibility notes

**Sync service**

- Electrification of tables that have no PRIMARY KEY or include unsupported constraints is now rejected.
- Table column types and constraints for new columns that are added to electrified tables with `ALTER TABLE ... ADD COLUMN` are now validated in the same way as when electrifying a table.
- Attempt to add a new foreign key to an electrified table with `ALTER TABLE ... ADD COLUMN` statements are now rejected.
- By default, Electric now enforces the use of SSL for database connections. If the database does not have SSL enabled, Electric can be started with `DATABASE_REQUIRE_SSL=false` as a workaround.

**TypeScript client**

- The `raw` API now throws for unsafe queries, i.e. anything other than read-only queries. This matches the behaviour of `liveRaw`.
- New `unsafeExec` API has been added to allow modifying the database, side-stepping the type-safe client checks.
- The `raw` and `liveRaw` query APIs have been deprecated in favour of `rawQuery`, `liveRawQuery` and `unsafeExec`.

**create-electric-app**

- Apps created with `create-electric-app` now use Vite as the dev server and build tool.


## 2023-12-13 - v0.8

[Announcement post](/blog/2023/12/13/electricsql-v0.8-released).

This release improves data model and deployment compatibility, including support for JSON and running on popular managed Postgres and application hosts, such as Supabase and DigitalOcean.

#### Updated components

Component | Version
--------- | -------
[Sync service][1] | [0.8.1](https://github.com/electric-sql/electric/blob/main/components/electric/CHANGELOG.md#081)
[TypeScript client][2] | [0.8.2](https://github.com/electric-sql/electric/blob/main/clients/typescript/CHANGELOG.md#082)
[create-electric-app][3] | [0.2.2](https://github.com/electric-sql/electric/blob/main/examples/starter/CHANGELOG.md#022)
[@electric-sql/prisma-generator][4] | [1.1.2](https://github.com/electric-sql/electric/blob/main/generator/CHANGELOG.md#112)

#### Compatibility notes

**Sync service**

- Attempts to update primary key columns in electrified tables are now rejected.

**TypeScript client**

- Table names are preserved in the generated type-safe client, i.e. `snake_cased` table names are no longer transformed to `PascalCased` model names. However, there's still a minor [caveat](/docs/usage/data-modelling/migrations#table-names) to be aware of.
- Prisma and the electric client generator are now dependencies of the TypeScript client. You no longer have to include them as dependencies of your web app. As a consequence, projects can use a different version of Prisma as a direct dependency.

## 2023-11-02 - v0.7

[Announcement post](/blog/2023/11/02/electricsql-v0.7-released).

Major highlights of this release are the introduction of the Migrations proxy and support for additional column types in electrified tables.

#### Updated components

Component | Version
--------- | -------
[Sync service][1] | [0.7.0](https://github.com/electric-sql/electric/blob/main/components/electric/CHANGELOG.md#070)
[TypeScript client][2] | [0.7.0](https://github.com/electric-sql/electric/blob/main/clients/typescript/CHANGELOG.md#070)
[create-electric-app][3] | [0.2.0](https://github.com/electric-sql/electric/blob/main/examples/starter/CHANGELOG.md#020)
[@electric-sql/prisma-generator][4] | [1.1.0](https://github.com/electric-sql/electric/blob/main/generator/CHANGELOG.md#110)

#### Compatibility notes

**Sync service**

- [Migrations proxy](/docs/usage/data-modelling/migrations#migrations-proxy) ia a new component running as part of the sync service. Its introduction affects the `DATABASE_URL` used when applying database migrations that contain [DDLX](/docs/api/ddlx) statements.

**TypeScript client**

- The minimum supported version of `capacitor-community/sqlite` has been increated to `5.4.1` to enable Android support.

**create-electric-app**

- Apps created with `create-electric-app` now also listen on port 65432 which is used by the Migrations proxy.

## 2023-09-20 - v0.6

[Announcement post](/blog/2023/09/20/introducing-electricsql-v0.6).

The first public release of ElectricSQL as a self-hosted sync layer on top of PostgreSQL.

[1]: https://hub.docker.com/r/electricsql/electric/tags
[2]: https://www.npmjs.com/package/electric-sql
[3]: https://www.npmjs.com/package/create-electric-app
[4]: https://www.npmjs.com/package/@electric-sql/prisma-generator
