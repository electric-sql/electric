# Electric SQL Recipes

A web app demonstrating common patterns and recipes implemented using Electric SQL.

## Recipes

### Activity Events

Example of real time social-media-like activities showing up as a toast and in a notifications dropdown with read acknowledgements.

- [Schema](db/migrations/01-activity_events_table.sql) - a more practical implementation would relate the `source` and `target` as foreign keys to users and/or user groups.
- [Activity Popover](src/activity_events/ActivityPopover.tsx) - shows recent notifications along with read acknowledgement badges.
- [Activity Toast](src/activity_events/ActivityToast.tsx) - pops up a toast everytime a new activity is received, with a read acknowledgement action and an another optional action specified in the schema

### Log Viewer

Example of viewing log messages in real time as well as historical logs.

- [Schema](db/migrations/02-logs_table.sql) - can be extended with a `log_level` column as well as a `type` or `source` column, to refine permissions to view.

- [Log Viewer](src/log_viewer/LogViewer.tsx) - shows recent log messages along with filtering and search capabilities.

## How to run the app

### Prerequisites

You need [NodeJS >= 16.11 and Docker Compose v2](https://electric-sql.com/docs/usage/installation/prereqs).

### Install

Install the dependencies:

```sh
npm install
```

### Setup

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
npm run backend:up
# Or `yarn backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
npm run db:psql
```

Setup your [database schema](https://electric-sql.com/docs/usage/data-modelling):

```shell
npm run db:migrate
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
npm run client:generate
# or `npm run client:watch`` to re-generate whenever the DB schema changes
```

### Run

Start your app:

```sh
npm run dev
```
