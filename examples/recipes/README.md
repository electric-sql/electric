# Electric SQL Recipes

A web app demonstrating common patterns and recipes implemented using Electric SQL.

## Recipes

### Log Viewer

Example of viewing log messages in real time as well as historical logs.

- [Schema](db/migrations/02-logs_table.sql) - can be extended with a `log_level` column as well as a `type` or `source` column, to refine permissions to view.

- [useLogs](src/log_viewer/use_logs.ts) hook - returns given number of most recent logs with optional text filter.

- [Log Viewer](src/log_viewer/LogViewer.tsx) - list UI for showing and filtering the logs

### Monitoring

Example of a dashboard for monitoring system metrics with a live graph with dynamic windowing.

- [Schema](db/migrations/04-monitoring_table.sql) - very general log table with arbitrary content.

- [useMonitoringMetrics](src/monitoring_metrics/use_monitoring_metrics.ts) hook - returns value range timeseries for specified monitoring metric

- [Monitoring Chart](src/monitoring_metrics/MonitoringChart.tsx) - graph UI showing minimum, average, and maximum CPU usage with configurable aggregation window and view range.

### Data Viewer

Example of viewing and querying data through something like an analytics dashboard. All operations are done with local data and SQL queries, making it very fast for both querying, pagination, sorting, etc.

- [Schema](db/migrations/07-data_viewer_table.sql) - defines a generic commerce/order table.

- [Data Viewer](src/data_viewer/DataViewer.tsx) - allows browsing, sorting, filtering, and charting tables.

### Activity Events

Example of real time social-media-like activities showing up as a toast and in a notifications dropdown with read acknowledgements.

- [Schema](db/migrations/01-activity_events_table.sql) - defines activities with a source and target, read acknowledgments, and a message with optional action. The `source_user_id` and `target_user_id` should operate as foreign keys to users and/or user groups.

- [useActivityEvents](src/activity_events/use_activity_events.ts) hook - get recent activities, total number of unread activities, and manage their read acknowledgement status

- [Activity Popover](src/activity_events/ActivityPopover.tsx) - popover UI that shows recent notifications along with read acknowledgement badges.

- [Activity Toast](src/activity_events/ActivityToast.tsx) - toast UI taht pops up everytime a new activity is received, with a read acknowledgement action and an another optional action specified

### Chatroom

Example of a realtime chatroom with persistence and offline resilience.

- [Schema](db/migrations/06-chat_room_table.sql) - stores chat messages with a timestamp, username, and message text - can be extended with delivery acknowledgements, reactions, replies referencing other rows within the table.

- [useChatRoom](src/chat_room/use_chat_room.ts) hook - returns a list of chat messages up to specified time, as well as a function to submit new messages.

- [Chatroom](src/chat_room/ChatRoom.tsx) - chatroom UI shows messages that update in realtime as new messages are sent or received.

### Background Jobs

Example of submitting and monitoring background jobs. Progress is updated by the backend processor and streamed in real time, while locally jobs can be submitted even while offline and optionally cancelled. Once the job is completed, the result is also replicated to the client.

- [Schema](db/migrations/05-background_jobs_table.sql) - stores job metadata like id, progress, result, etc.

- [useBackgroundJobs](src/background_jobs/use_background_jobs.ts) hook - manage background job submission, cancellation, and monitoring of progress.

- [Background Jobs](src/background_jobs/BackgroundJobs.tsx) - table UI for managing background jobs.

- [Server-side Job Processing](backend/demo-server/src/background-job-service.ts) - example of how Postgres notifications can be used to process jobs in the backend.

### Request-Response

Example of substituting regular API calls with submitting requests lcoally and and viewing responses as they come in. This has the main benefits of offline persistence - all requests made while offline will eventually get serviced once back onlline without needing retries and other mechanisms - as well as a full audit log of all requests made.

- [Schema](db/migrations/03-request_response_tables.sql) - stores requests and responses with metadata like timestamps, statuses, etc and ties

- [useElectricQuery](src/request_response/use_electric_query.ts) hook - write declarative query and get results as they come in.

- [useElectricQueryLog](src/request_response/use_electric_query_log.ts) hook - retrieve a log of all requests made.

- [Request Viewer](src/request_response/RequestResponse.tsx) - interface to submit new requests and view log of recent requests made and responses received.

- [Server-side Request Listener](backend/demo-server/src/pg-request-listener.ts) - example of how Postgres notifications can be used to process requests streaming into the backend.


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
# Or `npm run backend:start` to foreground
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
