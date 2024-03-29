---
title: Active-active replication
sidebar_position: 40
---

import ReplicationDemo from '!!raw-loader!@site/intro/src/demos/active-active/replication.jsx'

import {
  CommandCreds,
  InsertItemsCommand,
  PSQLCommand,
  UpdateSlidersCommand,
  WatchSlidersCommand,
} from '@site/intro/src/components/commands'

In the previous steps on [realtime multi-user](./multi-user.md) and [conflict-free offline](./offline.md), we've seen data sync between users and their devices. What we *haven't* yet seen is how it syncs via and with a Postgres database in the cloud.

## SQLite &lt;&gt; Postgres

Below, we've again embedded a simple local-first demo app with a slider and some items you can add and clear. This time, below it, we've also displayed the access credentials to connect to a cloud Postgres database.

<CodeBlock live={true} noInline={true} language="jsx">{
  ReplicationDemo
}</CodeBlock>

<CommandCreds dbName="user1" demoName="active-active">
  <PSQLCommand />

Fire up `psql` (see [install instructions](https://www.timescale.com/blog/how-to-install-psql-on-mac-ubuntu-debian-windows/) and/or [docker image](https://hub.docker.com/r/rtdl/psql-client)) and run:

<UpdateSlidersCommand />

You can see the app above react to the change in position of the slider. Now run a query to watch the position in Postgres:

<WatchSlidersCommand />

And then drag the position of the slider in the client. As you can see, replication is *bi-directional*. Changes from the local app sync into Postgres and changes from Postgres sync onto the local app.

## Content publishing

This means you can use Postgres as a management or publishing system. For example, publish items to the app above using `psql`:

<InsertItemsCommand />

</CommandCreds>

Run it a few times and watch the content sync in. It's fun!

More to the point, it turns your existing management interfaces (anything that writes to Postgres, be it Rails or Retool) into a content distribution tool for your local-first apps.

## Schema evolution

You can also use Postgres to update your local database schema. Write your DDL migrations [using your preferred web framework](../usage/data-modelling/migrations.md). Apply them to Postgres. ElectricSQL picks up on the changes and propagates them through the replication stream.

<hr className="doc-divider" />

So we've seen active-active replication and schema propagation. Now let's see how you control these replication flows using [dynamic sync controls &raquo;](./sync-controls.md)
