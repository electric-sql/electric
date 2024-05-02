---
title: Drivers
sidebar_position: 10
---

import DocCardList from '@theme/DocCardList';

Adapt the local database driver for your target environment.

## How drivers work

The ElectricSQL client works with existing SQLite and Postgres database drivers as well as [PGlite](http://github.com/electric-sql/pglite/), our WASM build of Postgres. Connect to your local database using your existing driver library. Then pass the database `conn` to your driver adapter's `electrify` function when [instantiating your Client](../../usage/data-access/client.md#instantiating-the-client).

## Supported drivers

We support the following drivers. If we don't currently support your platform, you can also [implement your own adapter](./drivers/other/generic).

<DocCardList />

## Community drivers

Third-party contributors maintain the following drivers:

- [Electric Dart](https://github.com/SkillDevs/electric_dart) - driver adapter and client for Dart/Flutter apps maintained by [@SkillDevs](https://github.com/SkillDevs)
