---
title: Use ElectricSQL with the Ionic Framework and Capacitor
description: >-
  A demo ElectricSQL mobile app built with the Ionic Framework and Capacitor - “Electric Appointments” is a simple appointment scheduling app, the type a company would use to schedule appointments with clients.
excerpt: >-
  Introducing Electric Appointments, a demo mobile app built
  with the Ionic Framework and Capacitor.
authors: [samwillis]
image: /img/blog/using-electricsql-with-the-ionic-framework-and-capacitor/header.jpg
tags: [example app]
outline: deep
post: true
---

> [!WARNING]
> This post describes a release of an old version of Electric that's no longer active. See the [Electric Next](/blog/2024/07/17/electric-next) post for context.

Included in the [newly released version 0.7](/blog/2023/11/02/electricsql-v0.7-released) of ElectricSQL is support for the Ionic Framework and Capacitor, enabling a developer to build natively installable apps using the Electric sync layer. We have built a demo app to show off this capability. This app also demonstrates the extended type support in this new release, using `timestamptz` and `boolean` types.

The [Ionic Framework](https://ionicframework.com) is an open source mobile UI toolkit for building modern, high quality cross-platform mobile apps from a single code base. It uses web components at its core, and has bindings for React, Angular, and Vue. For this demo we are using React. With Ionic it is possible to build native looking, and feeling, apps using only web technologies.

The team behind Ionic has also created [Capacitor](https://capacitorjs.com); this is the spiritual successor to Cordova and PhoneGap. Capacitor allows you to easily wrap a web app in a native web view to build both iOS and Android apps, enabling their distribution on the app stores. It is a common companion to the Ionic Framework.

The pairing of ElectricSQL with the Ionic Framework and Capacitor is a compelling route for rapid application development. It results in a single codebase for web, iOS and Android apps, along with full offline and collaborative real-time support.

:::info What is ElectricSQL?

ElectricSQL is an open source Local-first software platform. Use it to build super fast, collaborative, offline-capable apps directly on Postgres by syncing to a local SQLite database.

To find out more read our recent [v0.6 announcement post](https://electric-sql.com/blog/2023/09/20/introducing-electricsql-v0.6).
:::

## A simple scheduling app

For our demo application we chose to build a simple scheduling app - the type of app a company might use to schedule appointments with clients. It is split into two workflows; one for the customer to schedule an appointment, and another for an employee to view and administer their calendar.

We have used standard Ionic components throughout, and the app switches between a Material and iOS theme depending on environment.

You can see a demo of the app in the video below:

<video className="w-full" controls poster="/videos/blog/using-electricsql-with-the-ionic-framework-and-capacitor/main-demo.jpg">
  <source src="/videos/blog/using-electricsql-with-the-ionic-framework-and-capacitor/main-demo.mp4" />
</video>

The full source code of the app is here: [electric/examples/ionic-demo/](https://github.com/electric-sql/electric/tree/main/examples/ionic-demo)

## Using Electric in an Ionic React app

The `/src/electric.ts` file from our starter contains an `initElectric` function that first creates a local SQLite database, and then “Electrifies” it. This needs to be modified to use the Capacitor driver rather than the wa-sqlite based driver. However, in order to support both web deployments and Capacitor, we modify `initElectric` to conditionally set up either a wa-sqlite, or a Capacitor SQLite drive, depending on whether it is running in a native app or otherwise.

```typescript
// src/electric.ts
import { makeElectricContext } from 'electric-sql/react'
import { Capacitor } from '@capacitor/core'

// The generated electric client:
import { Electric, schema } from './generated/client'
export type { Issue } from './generated/client'

export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const initElectric = async () => {
  const electricUrl = import.meta.env.ELECTRIC_URL ?? 'ws://localhost:5133'
  const config = {
    auth: {
      token: insecureAuthToken({ user_id: genUUID() }),
    },
    url: electricUrl,
  }

  // Conditionally initiate either the wa-sqlite, or capacitor electric
  // depending on if we are in a native app or not.
  return Capacitor.isNativePlatform()
    ? await initCapacitorSQLite(dbName, config)
    : await initWaSQLite(dbName, config)
}

async function initWaSQLite(dbName: string, config: ElectricConfig) {
  // Import and initiate an electrified wa-sqlite
  const { ElectricDatabase, electrify } = await import('electric-sql/wa-sqlite')
  const conn = await ElectricDatabase.init(dbName, distPath)
  return await electrify(conn, schema, config)
}

async function initCapacitorSQLite(dbName: string, config: ElectricConfig) {
  // Import and initiate an electrified Capacitor SQLite
  const { electrify } = await import('electric-sql/capacitor')
  const { CapacitorSQLite, SQLiteConnection } = await import(
    '@capacitor-community/sqlite'
  )
  const sqliteConnection = new SQLiteConnection(CapacitorSQLite)
  const conn = await sqliteConnection.createConnection(dbName, false, '', 1, false,)
  await conn.open()
  return await electrify(conn, schema, config)
}
```

There are more details of how to [initialise an Electric client database in the documentation](https://electric-sql.com/docs/api/clients/typescript#instantiation).


## Conclusion

The combination of ElectricSQL with Ionic Framework and Capacitor is an incredible way to rapidly build applications that can be distributed to users as installable apps. With the live queries it is possible to build reactive UIs that update in realtime to both local and remote state changes, all with very little code.

We think that this pairing of tools will be a popular way to build apps with Electric.
