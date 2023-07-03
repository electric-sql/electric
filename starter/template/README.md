# Welcome to your ElectricSQL app!

## Setup

Install the dependencies:

```sh
pnpm install
```

## Backend

Build and start the backend:

```sh
pnpm backend:start
```

The above command builds the latest Electric image and starts a fresh Postgres DB and the Electric sync service.

Now, migrate Postgres such that it contains the necessary tables for your app to work:
```sh
pnpm backend:migrate
```

## Frontend

In order for your app to interact with the backend, you need to generate an Electric client:
```sh
npx electric-sql generate
```
This command generates an Electric client that is up-to-date with the data model on Postgres.

Now, you can build and run the app:
```sh
pnpm build && pnpm start
```

Open http://localhost:3001 in your web browser.

### Re-generate the Electric client

Whenever the data model in Postgres changes, the Electric client must be updated accordingly.
To this end, generate an updated Electric client:
```sh
npx electric-sql generate
```
