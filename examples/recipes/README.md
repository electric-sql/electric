# Electric SQL Recipes

A simple web app demonstrating common patterns and recipes implemented using Electric SQL.

## Recipes

### Activity Events

Simple example of real time social-media-like activities showing up as a toast if occurring in real time and in a notifications dropdown with read acknowledgements.

Schema can be found in `db/migrations/01-activity_events_table.sql` - a more practical implementation could relate sources and targets for the events to users and user groups.

The `ActivityPopover.tsx` and `ActivityToast.tsx` components under `src/activity_events/` illustrate the respective functionalities.

## Pre-reqs

You need [NodeJS >= 16.11 and Docker Compose v2](https://electric-sql.com/docs/usage/installation/prereqs). Install `yarn` if you don't have it already:

```shell
npm -g install yarn
```

## Install

Install the dependencies:

```sh
yarn install
```

## Setup

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
yarn backend:up
# Or `yarn backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
yarn db:psql
```

Setup your [database schema](https://electric-sql.com/docs/usage/data-modelling):

```shell
yarn db:migrate
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
yarn client:generate
# or `yarn client:watch`` to re-generate whenever the DB schema changes
```

## Run

Start your app:

```sh
yarn dev
```
