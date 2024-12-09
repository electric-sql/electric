# Yjs Electric provider

This example showcases a multiplayer [Codemirror](https://codemirror.net/) editor with [YJS](https://github.com/yjs/yjs) and [ElectricSQL](https://electric-sql.com/). All data is synchronized through [Postgres](https://www.postgresql.org/), eliminating the need for additional real-time infrastructure. 

Y-Electric is a [YJS connection provider](https://docs.yjs.dev/ecosystem/connection-provider) that comes with offline support, integrates with [database providers](https://docs.yjs.dev/ecosystem/database-provider) and also handles [Presence/Awareness](https://docs.yjs.dev/api/about-awareness) data. It works with the entire YJS ecosystem and with you existing apps too!

> We're releasing The Y-Electric backend as a package soon!

## How to run

Make sure you've installed all dependencies for the monorepo and built the packages (from the monorepo root directory):

```shell
pnpm install
pnpm run -r build
```

Start the docker containers (in this directory):

```shell
pnpm backend:up
```

Start the dev server:

```shell
pnpm dev
```