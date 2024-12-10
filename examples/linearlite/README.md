
# Linearlite

This is a comprehensive example of a local-first [Linear](https://linear.app) clone built with [Electric](https://electric-sql.com) and [PGlite](https://pglite.dev).

Linear is a collaborative project management app for teams, built on a [sync engine architecture](https://linear.app/blog/scaling-the-linear-sync-engine). Linearlite is an example app that shows how you can build a Linear-quality application using Electric and PGlite. It's built on top of the excellent clone of the Linear UI built by [Tuan Nguyen](https://github.com/tuan3w).

It uses syncs data using Electric into a local PGlite database and uses a [write through the database](https://electric-sql.com/docs/guides/writes#through-the-db) pattern, where local mutations are saved to the local database and then synced to the server. See the [Write Path](#write-path) section below for more details.

## Data set

Linearlite is configured to load a large dataset of 100,000 issues, with comments, totally ~150MB into the local database. It demonstrates both fast initial sync and instant local reactivity, using fast, windowed live queries in PGlite. As such, it is intended to show how you can build large-scale, real-world apps on Electric and PGlite.

## Features

The following features are implemented:

- full bi-directional sync of data to and from the server
- an indicator on each issue to show if it's been synced to the server
- filtering and sorting of issues and comments
- a kanban board for issues with drag and drop reordering (with conflict free ordering handled using fractional indexes)
- full text search of issues and comments using Postgres's `tsvector` and `tsquery` features

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

> Note that this always stops and deletes the volumes mounted by any other example backend containers that are running or that have been run previously. This ensures that the example always starts with a clean database and clean disk.

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

2. **Electric Sync Service**: Runs in front of Postgres, managing data synchronization from it to the clients. Produces replication streams for a subset of the database - these are called "shapes".

3. **Write Server**: A simple HTTP server that handles write operations, applying them to the Postgres database.

### Frontend Components

1. **PGlite**: An in-browser database that stores a local copy of the data, enabling offline functionality and fast queries.

2. **PGlite + Electric Sync Plugin**: Connects PGlite to the Electric sync service and loads the data into the local database.

3. **React Frontend**: A Linear-inspired UI that interacts directly with the local database.

## Write Path

This example uses a "write through the database" pattern, where local mutations are saved to the local PGlite database and then synced to the server. There are a number of ways to implement this, broadly split into two patterns:

1. **Merge on write:** There is a single table in the local database that contains all of the data. Local mutations are applied to this table and then synced to the server. As syncs are applied from the server, any pending changes are merged with the new data.

2. **Merge on read:** There are two tables in the local database for each table of data: One is a pure replica of the server data and never has local mutations; and the other is a "delta" table that contains the local mutations. When the data is read, the two tables are joined on the id, and the result is the complete data set. This pattern can be extended by using a view to merge the data from the two tables, with `instead of` triggers to apply the local mutations to the "delta" table.

This example uses the first pattern, which has a more performant read path and is ideal for large datasets. Below is a brief explanation of how it works:

The local database schema has a number of additional columns on each table that are used to maintain state for the write path and to resolve conflicts:

- `deleted`: A boolean flag to indicate if the row has been deleted.
- `new`: A boolean flag to indicate if the row has been inserted.
- `modified_columns`: An array of columns that have been modified.
- `sent_to_server`: A boolean flag to indicate if the row has been sent to the server.
- `synced`: A boolean flag to indicate if the row has been synced to the server ans is a pure replica of the server data.
- `backup`: A JSONB column to store the backup of the row data for modified columns. A row can be reverted to the backup (server) state using the `revert_local_changes(table_name, row_id)` function.

Subsequently, there is a series of triggers on the local database that maintain the state of the write path. These are defined in the `db/migrations-client/01-create_tables.sql` file. The PGlite sync plugin sets the configuration variables `electric.syncing` to `true` when a sync is in progress and `false` otherwise. These triggers use that value to determine the action that should be performed:

### During Sync `electric.syncing = true`

#### Insert
- Checks if the row already exists in the database; if it does, it's handled as an update instead, [see below](#update).
- Sets `modified_columns` to an empty array
- Sets `new` flag to false
- Sets `sent_to_server` flag to false
- `synced` flag is set to true to indicate that the row is a pure replica of the server data.

#### Update
- For synced rows or rows where server changes are newer (`sent_to_server = true` and `NEW.modified >= OLD.modified`):
  - Applies all updates
  - Resets `modified_columns` to empty array
  - Clears the `backup` column
  - Sets `new` and `sent_to_server` flags to false
- For rows with local changes:
  - Only updates columns that aren't in `modified_columns`
  - Saves the old values of updated columns to the `backup` JSONB column
  - Sets `new` flag to false

#### Delete
- Performs actual deletion of the row from the database
- No soft delete is used during sync operations

### During Local Writes `electric.syncing = false`

#### Insert
- Adds all non-local-state columns to `modified_columns` array to indicate that they have been modified
- Sets `new` flag to true, indicating that the row is new
- Sets `sent_to_server` flag to false, indicating that the row has not been sent to the server

#### Update
- For each changed column that isn't already in `modified_columns`:
  - Adds the column name to `modified_columns`
  - Saves the original value to the `backup` JSONB column
- Sets `sent_to_server` to false, scheduling the row for sync
- Doesn't modify tracking columns that are already in `modified_columns`

#### Delete
- For new rows (`new = true`):
  - Performs actual deletion since the row hasn't been synced
- For existing rows:
  - Sets `deleted` flag to true instead of actually deleting
  - Row remains in database for sync purposes

### Performing the sync

The client side of the write-path sync process is handled by `startWritePath` in `/src/sync.ts`, this is called when the app first loads. This function sets up a live query to monitor changes in the local database that need to be synced to the server. Here's how it works:

1. Uses a live query to continuously watch for any unsynced rows in both the `issue` and `comment` tables (where `synced = false`).
2. Collects all unsynced changes that haven't been sent to the server yet
3. Sends these changes to the write server via a POST request
4. On successful server response, marks the changes as `sent_to_server = true`
5. The Electric sync process will eventually sync the server changes back, at which point the rows will be marked as `synced = true` by the triggers on the tables when the rows arrive.

### Write Server

The write server is a simple HTTP server that handles write operations, applying them to the Postgres database - it's implemented in the `write-server.ts` file using Hono. There is also a version in `./superbase/functions/write-server` that uses the Supabase edge functions.

This version of the write server is fairly simple, applying the operations to the database and then returning a 200 OK response. However, it could be extended to handle auth and permissions, rejecting operations that don't have the correct authorisation.

### Other considerations

In order to provide the best user experience, the app does the following:

- The triggers in the initial database migrations are disabled until after the initial sync is complete; this prevents the triggers from firing, and increasing the performance overhead, until the sync is complete.

- We also delay index creation until after the initial sync is complete, preventing the indexes from being created while the sync is in progress as this would slow the process.

- Creation of the full text search index is delayed until the user first opens the search feature - this ensures that the time to reach a functioning app from the initial sync is as fast as possible.
