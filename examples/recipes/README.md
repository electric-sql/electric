# Electric SQL Recipes

A web app demonstrating common patterns and recipes implemented using Electric SQL.

## Recipes

### Log Viewer

Example of viewing log messages in real time as well as historical logs.

- [Schema](db/migrations/02-logs_table.sql) - can be extended with a `log_level` column as well as a `type` or `source` column, to refine permissions to view.

- [Log Viewer](src/log_viewer/LogViewer.tsx) - shows recent log messages along with filtering and search capabilities.

### Monitoring

Example of a dashboard for monitoring system metrics with a live graph with dynamic windowing.

- [Schema](db/migrations/02-logs_table.sql) - very general log table with arbitrary content.

- [Monitoring Chart](src/monitoring_metrics/MonitoringChart.tsx) - graph showing minimum, average, and maximum CPU usage with configurable aggregation window and view range.

### Data Viewer

Example of viewing and querying data through something like an analytics dashboard. All operations are done with local data and SQL queries, making it very fast for both querying, pagination, sorting, etc.

- [Schema](db/migrations/04-data_viewer_tables.sql) - defines a generic commerce/order table.

- [Data Viewer](src/data_viewer/DataViewer.tsx) - allows browsing, sorting, filtering, and charting tables.

### Activity Events

Example of real time social-media-like activities showing up as a toast and in a notifications dropdown with read acknowledgements.

- [Schema](db/migrations/01-activity_events_table.sql) - a more practical implementation would relate the `source` and `target` as foreign keys to users and/or user groups.
- [Activity Popover](src/activity_events/ActivityPopover.tsx) - shows recent notifications along with read acknowledgement badges.
- [Activity Toast](src/activity_events/ActivityToast.tsx) - pops up a toast everytime a new activity is received, with a read acknowledgement action and an another optional action specified in the schema

### Chatroom

Example of a realtime chatroom with persistence and offline resilience.

- [Schema](db/migrations/05-chat_room_table.sql) - stores chat messages with a timestamp, username, and message text - can be extended with delivery acknowledgements, reactions, replies referencing other rows within the table.

- [Chatroom](src/chat_room/ChatRoom.tsx) - shows a list of chat messages that updates in realtime as new messages are sent or received. Allows sending messages.

### Background Jobs

Example of submitting and monitoring background jobs. Progress is updated by the backend processor and streamed in real time, while locally jobs can be submitted even while offline and optionally cancelled. Once the job is completed, the result is also replicated to the client.

- [Schema](db/migrations/06-background_jobs_table.sql) - stores job metadata like id, progress, result, etc.

- [Background Jobs](src/background_jobs/BackgroundJobs.tsx) - shows a list of jobs that updates in realtime as new jobs are submitted and processed.

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
