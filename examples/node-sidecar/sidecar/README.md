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

# ElectricSQL - NodeJS sidecar

This is a NodeJS sidecar running Electric.
It automatically syncs any electrified table.
Applications can connect to this sidecar over a regular TCP socket.
The sidecar informs the application of DB changes.

## Instructions

Start the sidecar:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/node-sidecar/sidecar
yarn # install dependencies
yarn start <path-to-db-file> # e.g. yarn start ../clients/node/electric.db
```

This will start the sidecar and open the database file.
It creates the database file if it does not exist.
Now that the sidecar is up and running, run your application that connects to it.
An example application can be found in `electric/examples/node-sidecar/clients/node`.
