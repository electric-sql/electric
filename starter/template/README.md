# Welcome to your ElectricSQL app!

## Setup

Install the dependencies:

```sh
yarn install
```

## Backend

Build and start the backend:

```sh
yarn backend:start
```

The above command builds the latest Electric image and starts a fresh Postgres DB with the Electric sync service.

Now, migrate Postgres such that it contains the necessary tables for your app to work:
```sh
yarn db:migrate
```

## Frontend

In order for your app to interact with the backend, you need to generate an Electric client:
```sh
yarn client:generate
```
This command generates an Electric client that is up-to-date with the data model on Postgres.

Now, you can build and run the app:
```sh
yarn start
```

Open http://localhost:3001 in a web browser to access the application.

### Re-generate the Electric client

Whenever the data model in Postgres changes, the Electric client must be updated accordingly.
To this end, generate an updated Electric client:
```sh
yarn client:generate
```

Alternatively, you can run the above command in watch mode such that the client is re-generated automatically when the data model changes:
```sh
yarn client:generate -- --watch
```