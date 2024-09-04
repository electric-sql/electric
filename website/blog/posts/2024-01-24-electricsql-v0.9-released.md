---
title: ElectricSQL v0.9 released
description: >-
  Version 0.9 of ElectricSQL. A local-first sync layer that you can use to build reactive, realtime, offline-capable apps directly on Postgres with your existing data model.
authors: [oleksii, samwillis]
image: /img/blog/introducing-electric-sql/image.jpg
tags: [release]
outline: deep
post: true
---

To set the tone for 2024, we're kicking January off with a fresh release of Electric that introduces a whole slew of improvements to the experience of configuring, deploying, and developing with Electric.

<!--truncate-->

This new version addresses an array of issues that have been reported by our [community](/about/community#discord) and early adopters. Thanks to everyone who has provided feedback and bug reports!

## New CLI commands

The Electric client library now boasts a powerful [Command-Line Interface](/docs/api/cli) (CLI), enhancing the development experience for Electric apps. This replaces all of the scripts that were previously included in our `create-electric-app` starter. Adding Electric to an existing project, or to a new project from a framework starter, is now just:

```sh
npm install electric-sql
```

Once installed, the Electric CLI can be accessed with `npx electric-sql [command-name]`. It accepts arguments and environment variables, using [dotenv-flow](https://www.npmjs.com/package/dotenv-flow) to load from `.env` files. A minimal `.env` file is:

```sh
ELECTRIC_SERVICE=http://localhost:5133
ELECTRIC_PG_PROXY_PORT=65432
```

The CLI's key features include commands like [`start`](/docs/api/cli#start), [`stop`](/docs/api/cli#stop), and [`status`](/docs/api/cli#status) for managing development environments. For example, to start Electric with a Postgres database, you would use:

```sh
npx electric-sql start --with-postgres
```

For custom Postgres configurations, you can set `ELECTRIC_DATABASE_URL` in your `.env` file.

The CLI also includes a new [`with-config`](/docs/api/cli#with-config) command which simplifies database migrations by integrating third-party migration tools with Electric's environment settings.

Finally, the [Local-first-only workflow](/docs/api/cli#local-only-first-mode), with the `npx electric-sql generate --with-migrations` command, allows for backend-free initial development by automatically setting up and tearing down a temporary Postgres and Electric environment, applying migrations, and generating a client.

## Other client tooling improvements

In this new version of the Electric Client we have also made a number of other improvements:

1. The client now supports bundling of the wa-sqlite WASM. Previously when initiating an Electric client in the browser, it was necessary to provide the url to the directory where the wa-sqlite WASM build was located. That argument is now optional, and most bundlers will pick up the wa-sqlite WASM file and include it in the build.

2. The `db.raw` and `db.liveRaw` APIs are deprecated, replaced with explicit read (`db.rawQuery` and `db.liveRawQuery`) and unsafe write (`db.unsafeExec`) APIs. Caution is advised with `db.unsafeExec` as it bypasses any type validation and could result in the SQLite database being unable to sync with Postgres.

3. The build tooling has switched to [tsup](http://tsup.egoist.dev), enabling source maps for easier debugging.

4. To accommodate `moduleResolution` set to `nodenext` in `tsconfig.json`, the `ELECTRIC_MODULE_RESOLUTION` environment variable ensures compatibility of the generated client with these TypeScript environments.

## Experimental enum type support

Another highlight of this release is the introduction of experimental support for enum types in electrified tables.

Here's a teaser:

```sql
CREATE TYPE colour AS ENUM (
  'red', 'yellow', 'purple', 'cyan', 'green'
);

CREATE TABLE paints (
  id uuid PRIMARY KEY,
  colour colour NOT NULL
);

ALTER TABLE paints ENABLE ELECTRIC;
```

We'll be releasing a followup post soon that will cover the usage of enum types with Electric in detail. Stay tuned!

## New guide: Deployment Concepts

Don't we all just love it that we can drop Electric onto a classical cloud-first app stack backed by a Postgres database and have it start syncing data between the database and client apps automatically? That's the premise and proposition that we're working hard to deliver on. However, there are still a few moving parts to an Electric deployment that can take some time to understand and are useful to get your head around.

Fear not, though, as we recently published a new guide that provides an in-depth look into the various components of an electrified app stack and how they all fit together. Here's a teaser:

![Components and connections](/img/blog/electricsql-v0.9-released/components-and-connections.png)

Go read our new [Deployment Concepts](/docs/deployment/concepts) guide to learn all about it.

## Configuration improvements for easier deployments

### Transparent support for IPv6 and IPv4

As a user of Electric, you no longer need to think about whether your hosting provider uses IPv4 or IPv6 and which protocol your hosted Postgres is available on. Electric now makes all of its open ports available on both protocols and it can connect to a database that is accessible only via IPv6 or only via IPv4 with no additional configuration. There are, nevertheless, configuration options that allow for [overriding of these defaults](/docs/api/service#database_use_ipv6).

### SSL-encrypted database connections by default

In this new release, we're changing the default behaviour of Electric to use SSL for all connections to the database with no automatic fallback to disabling encryption. We've made this change to better align with a "secure by default" model while still providing a way to [change this default behaviour](/docs/api/service#database_require_ssl) if your use case calls for that.

Now, when you run Electric with a local Postgres database in development or if you know that your Electric + Postgres deployment is secured by your infrastructure (e.g. by making sure Electric connects to Postgres over a VPN), set `DATABASE_REQUIRE_SSL=false` and Electric will fallback to using unencrypted connections.

Security is always on our minds when we're working on new Electric features. There's still more to be done for SSL support, such as adding ceritificate verification checks and ways to configure which certificate store Electric should use. Stay tuned for more security improvements in future releases.

### Config validation at startup for easier troubleshooting

When deploying Electric to a new environment, it can be challenging to get everything right on the first try. To help our users get to a working deployment faster, we've made Electric validate all of its required configuration options at startup and log a descriptive error message in case there's a missing option or an invalid value was used.

Here's an example error message:

```
$ docker run --rm \
      -e DATABASE_URL="postgresql://localhost" \
      -e LOG_LEVEL=absolute \
      electric:local-build
▓ ┌───────────────────────┐
▓ │  CONFIGURATION ERROR  │
▓ ┕━━━━━━━━━━━━━━━━━━━━━━━┙
▓
▓ The following required configuration options have invalid or missing values:
▓
▓   * AUTH_JWT_ALG not set
▓
▓   * DATABASE_URL has invalid or missing username
▓
▓   * LOGICAL_PUBLISHER_HOST not set
▓
▓   * LOG_LEVEL has invalid value: "absolute". Must be one of ["error", "warning", "info", "debug"]
▓
▓   * PG_PROXY_PASSWORD not set
▓
▓ Please review the official configuration reference at
▓ https://electric-sql.com/docs/api/service
▓ and double-check your values.

••• Shutting down •••
```

## Descriptive errors for common issues

Some problems are common enough that different people report the same issue over and over. We've done a review of the common failure modes that you've encountered when starting out with Electric for the first time and we've added descriptive error messages for those.

Below are a couple of examples:

```
▓ ┌────────────────────────────────┐
▓ │  DATABASE CONFIGURATION ERROR  │
▓ ┕━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┙
▓
▓ Your Postgres database is not configured with wal_level=logical.
▓
▓ Visit https://electric-sql.com/docs/usage/installation/postgres
▓ to learn more about Electric's requirements for Postgres.

••• Shutting down •••
```

```
▓ ┌────────────────────┐
▓ │  CONNECTION ERROR  │
▓ ┕━━━━━━━━━━━━━━━━━━━━┙
▓
▓ Failed to establish replication connection to Postgres:
▓   replication slot "electric_replication_out_electric" is active for PID 59
▓
▓ Another instance of Electric appears to be connected to this database.
15:09:48.997 pid=<0.973.0> origin=postgres_1 [info] schedule retry: 2000
```

## Bug fixes and more

Every new release of Electric includes bug fixes and small improvements. For a full list of updated components see [Release notes](/docs/reference/release_notes#2024-01-24---v09).
