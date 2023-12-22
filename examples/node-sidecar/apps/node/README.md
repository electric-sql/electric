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

# ElectricSQL - NodeJS example app

This is an example of a NodeJS application that uses the sidecar.
This application connects to the sidecar and subscribes to changes.
On every change, the table is queried again and the results are displayed.

## Instructions

Run the Electric backend:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/node-sidecar/clients/node
yarn backend:start
```

Migrate the Postgres database:

```sh
yarn db:migrate
```

Then, start the sidecar:
```sh
cd electric/examples/node-sidecar/sidecar
yarn start <path-to-db-file> # e.g. yarn start ../clients/node/electric.db
```

Now, run one or more instances of this application:

```sh
cd electric/examples/node-sidecar/clients/node
yarn start <path-to-db-file> # e.g. yarn start electric.db
```

Make sure that the provided db file is the same as the one the sidecar is using.