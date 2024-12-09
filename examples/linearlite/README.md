# Linearlite + PGlite + ElectricSQL

This is a demo app that shows how to build a local-first app using PGlite and the ElectricSQL sync engine.

It's an example of a team collaboration app such as Linear built using ElectricSQL - a sync engine that synchronises little subsets of your Postgres data into local apps and services. So you can have the data you need, in-sync, wherever you need it.

It's built on top of the excellent clone of the Linear UI built by [Tuan Nguyen](https://github.com/tuan3w).

## Setup

This example is part of the [ElectricSQL monorepo](../..) and is designed to be built and run as part of the [pnpm workspace](https://pnpm.io/workspaces) defined in [`../../pnpm-workspace.yaml`](../../pnpm-workspace.yaml).

Navigate to the root directory of the monorepo, e.g.:

```shell
cd ../../
```

Install and build all of the workspace packages and examples:

```shell
pnpm install
pnpm run -r build
```

Navigate back to this directory:

```shell
cd examples/linearlite
```

Start the example backend services using [Docker Compose](https://docs.docker.com/compose/):

```shell
pnpm backend:up
```

> Note that this always stops and deletes the volumes mounted by any other example backend containers that are running or have been run before. This ensures that the example always starts with a clean database and clean disk.

Start the write path server:

```shell
pnpm run write-server
```

Now start the dev server:

```shell
pnpm dev
```

When you're done, stop the backend services using:

```shell
pnpm backend:down
```

## How it works

Linearlite demonstrates a local-first architecture using ElectricSQL and PGlite. Here's how the different pieces fit together:

### Backend Components

1. **Postgres Database**: The source of truth, containing the complete dataset.

2. **Electric Sync Service**: Runs in front of Postgres, managing data synchronization from it to the clients. Preduces replication streams for a subset of the database called "shapes".

3. **Write Server**: A simple HTTP server that handles write operations, applying them to the Postgres database.

### Frontend Components

1. **PGlite**: An in-browser database that stores a local copy of the data, enabling offline functionality and fast queries.

2. **PGlite + Electric Sync Plugin**: Connects PGlite to the Electric sync service and loads the data into the local database.

3. **React Frontend**: A Linear-inspired UI that interacts directly with the local database.
