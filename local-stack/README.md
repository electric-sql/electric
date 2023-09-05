# Fully local development against the ElectricSQL stack

## Running a local stack

Electric services are packaged as Docker containers. They can be run locally using the `docker-compose.yaml` file in this directory:

```bash
# Use environment variables from `.envrc` file
source .envrc
docker compose pull
docker compose up -d
```

> You can use a different image for the Electric server by customising `ELECTRIC_IMAGE`.

You might encounter errors if any of the specified ports are already taken on your machine - just edit the port binds and keep the new values in mind.

## Developing against the local stack

### Setting up Postgres

You can set up your Postgres instance by connecting to it and creating the necessary tables.
To connect to the Postgres instance run the following command:

```bash
docker compose exec -it -e PGPASSWORD=password postgres_1 \
       psql -h 127.0.0.1 -U postgres -d electric
```

Now, in the Postgres shell you can create a table:

```
electric=# CREATE TABLE "items" (
  "value" TEXT NOT NULL,
  CONSTRAINT "items_pkey" PRIMARY KEY ("value")
);
```

By default, this table won't be exposed to applications connecting to your Electric backend.
To expose the table, you need to electrify it:

```
electric=# CALL electric.electrify('items');
```

Now, you can write data to this table and it will automatically be replicated to all connected clients.

### Typescript client

Use a typescript client version that is compatible with Electric. The `electric-sql` dependency ([0.4.3][1]) used in the provided [examples][2] is compatible with the Electric image ([0.1.3][3]) that is deployed in the ElectricSQL Cloud and is preconfigured in `.envrc`. Check the [troubleshooting][4] section if you want to experiment with different versions of the server or the client.

[1]: https://github.com/electric-sql/typescript-client/tree/0.4.3
[2]: https://github.com/electric-sql/examples
[3]: https://github.com/electric-sql/electric/tree/0.1.3
[4]: #incompatible-protocol-versions

### Configure your application

To work with your Electric backend, you can generate an Electric client for your application:

```bash
npx electric-sql generate [--source <url>] [--out <path>]
```

The command above supports 2 optional arguments:

- `--source <url>` to specify the url to the Electric endpoint.
  If not provided it uses the default url `http://localhost:5133`
- `--out <path>` to customise where the generated client is written.
  If not provided the default path is `./src/generated/models`

## Troubleshooting

### Incompatible protocol versions

If you get the error message : `couldn't start replication: Error: server replied with error code: 5` while attempting to connect to Electric, it indicates there is a mismatch between the protocol versions the typescript client and the electric server are using. Electric restricts connections from any client that does not use the same major protocol version. To troubleshoot this issue, you can verify the protocol files used by the client and server in these locations:

- [typescript-client](https://github.com/electric-sql/electric/blob/main/clients/typescript/src/_generated/protocol/satellite.ts)
- [electric](https://github.com/electric-sql/electric/blob/main/components/electric/lib/electric/satellite/protobuf_package.ex)
