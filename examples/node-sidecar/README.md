<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

# ElectricSQL - NodeJS Sidecar

This is an example of a NodeJS sidecar for Electric and an application using the sidecar.
The sidecar runs Electric in a NodeJS process to which applications can connect.
The sidecar notifies the applications of incoming changes.
Similarly, applications notify the sidecar of potential changes that need to be synced with Electric.

## Installing dependencies

Install the sidecar's dependencies:
```sh
cd sidecar
yarn
```

Also install the application's dependencies:
```sh
cd apps/node
yarn
```

## Quickstart

Before you can run the application, you need to start Postgres and the Electric sync service:
```sh
cd apps/node
yarn backend:start # or backend:up to run in the background
```

Open another terminal to migrate the Postgres database and generate an Electric client for the application: 
```sh
cd apps/node
yarn db:migrate
yarn client:generate
```

Now, you can run the application and the sidecar with the following command (from the root folder):
```sh
node run.js
```

We configured the sidecar to listen on port 8230 (which should be free) and use the default connection URL for Electric. If that port is not free or you need to change the connection URL for Electric you can follow the configuration steps below.

You now have an interactive shell application that is communicating with electric through the sidecar over a TCP socket. You can implement the same pattern in other languages, by implementing the IPC socket protocol (see ```sidecar/src/ipc/socket.ts```).

Go ahead and add some items to the database. Check that the added items have been written to the database, by connecting to the Postgres database using `psql`:

```sh
cd apps/node
yarn db:psql
```

Now add some new record to the `items` table directly on Postgres and see it reactively appear on the node application.

When you're done, you can tear down Postgres and the Electric sync service:

```sh
cd apps/node
yarn backend:down # or backend:up to run in the background
```

## Sidecar configuration

The sidecar needs to be configured to work with a local SQLite database file and to connect to Electric.
To this end, you can modify the `config.json` file in `sidecar/`:
```json
{
  "service": "http://localhost:5133",
  "databaseFile": "../examples/node/electric-sidecar-node-example.db",
  "ipc": {
    "port": 8230
  },
  "auth": {
    "token": "your auth token"
  },
  "sync": ["items"]
}
```

The config file defines the connection URL for Electric, the database file to use, the port on which the sidecar should listen for connections from the application, the authentication token for Electric, and the tables to sync. The service and authentication tokens are optional. If not provided, they default to `"http://localhost:5133"` and a dummy authentication token.

Similarly, we need to configure the application such that it can connect to the sidecar.
To this end, you can modify the `config.json` file in `apps/node`. It only requires the database file and the IPC port:
```json
{
  "databaseFile": "./electric-sidecar-node-example.db",
  "ipc": {
    "port": 8230
  }
}
```

Make sure that the provided db file is the same as the one the sidecar is using.