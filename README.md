[![CI](https://github.com/electric-sql/electric/workflows/CI/badge.svg)](https://github.com/electric-sql/electric/actions/workflows/ci.yml)
[![License - Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue)](main/LICENSE)
![Status - Alpha](https://img.shields.io/badge/status-alpha-red)
[![Chat - Discord](https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord)](https://discord.gg/B7kHGwDcbj)

<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

# ElectricSQL

Local-first. Electrified.

You develop local-first apps. We provide the cloud sync. Without changing your database or your code.

## What is ElectricSQL?

ElectricSQL is a local-first SQL system that adds active-active replication and reactive queries to SQLite and Postgres. Use it to make local-first apps that feel instant, work offline and sync via the cloud.

## Getting started

- [Quickstart](https://electric-sql.com/docs/usage/quickstart)
- [Examples](https://github.com/electric-sql/examples)
- [Documentation](https://electric-sql.com/docs)

## Repo structure

This repository contains the main parts of the sync layer in the `components` directory, the clients that are meant to interface with that sync layer in the `clients` directory, e2e tests in `e2e` directory.

## Contributing

See the [Community Guidelines](https://github.com/electric-sql/meta) including the [Guide to Contributing](https://github.com/electric-sql/meta/blob/main/CONTRIBUTING.md) and [Contributor License Agreement](https://github.com/electric-sql/meta/blob/main/CLA.md).

## Support

We have an [open community Discord](https://discord.gg/B7kHGwDcbj). If you’re interested in the project, please come and say hello and let us know if you have any questions or need any help or support getting things running.
