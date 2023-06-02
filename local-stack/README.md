# Fully local development against the ElectricSQL stack

## Running a local stack

Electric services are packaged as docker containers. They can be run locally using the `docker-compose.yaml` file in this directory:

```bash
# Use environment variables from `.envrc` file
source .envrc
docker compose pull
docker compose up -d
```

> You can use a different image for the Electric server by customising `ELECTRIC_IMAGE`.

The local console is required to emulate interaction with the ElectricSQL Cloud when using the CLI tooling. You might encounter errors if any of the specified ports are already taken on your machine - just edit the port binds and keep the new values in mind.

## Developing against the local stack

### CLI tool

Ensure that you have the CLI tool ([0.5.0](https://github.com/electric-sql/cli/tree/v0.5.0)) installed. If you haven't installed it yet, follow the [instructions](https://electric-sql.com/docs/usage/install) to install it. The CLI is preconfigured to point to the console running in ElectricSQL Cloud. You can set the `ELECTRIC_CONSOLE_URL` environment variable to point to the local console:

```bash
# This variable is also exported in `.envrc`
export ELECTRIC_CONSOLE_URL=http://127.0.0.1:4000
```

CLI usage against the local console is limited (i.e. no account or app management), but all the commands with migration generation & sync will work. One exception is that when running `electric init <app>`, you should run `electric init <app> --no-verify` as the app name is ignored when running only a single instance locally.

### Typescript client

Use a typescript client version that is compatible with Electric. The `electric-sql` dependency ([0.4.3](https://github.com/electric-sql/typescript-client/tree/0.4.3)) used in the provided [examples](https://github.com/electric-sql/examples) is compatible with the Electric image ([0.1.3](https://github.com/electric-sql/electric/tree/0.1.3)) that is deployed in the ElectricSQL Cloud and is preconfigured in  `.envrc`. Check the [troubleshooting](Compatible protocol version) section If you want to experiment with different versions of the server or the client.

### Configure your application

In the root of your application, use the CLI to configure your application to run against the local stack:

> You can run the following commands for an existing application or one of the examples.

```bash
electric config add_env local
electric config update_env --set-as-default \
                           --replication-disable-ssl \
                           --replication-host 127.0.0.1 \
                           --replication-port 5133 \
                           --console-disable-ssl \
                           --console-host 127.0.0.1 \
                           --console-port 4000 \
                           local
```

### Apply migrations locally

You can apply migrations to the Postgres instance running on your local stack using the CLI.

Build your migrations:

```bash
electric build
```

Sync them with local stack:

```bash
# export ELECTRIC_CONSOLE_URL=http://127.0.0.1:4000
electric sync --local
```

### Connect to the Postgres instance

You can write data directly to the Postgres instance and have it replicated to clients over logical replication:

```bash
docker compose exec -it -e PGPASSWORD=password postgres_1 \
       psql -h 127.0.0.1 -U postgres -d electric
```

### Troubleshooting

### Incompatible protocol versions

If you get the error message : ```couldn't start replication: Error: server replied with error code: 5``` while attempting to connect to Electric, it indicates there is a mismatch between the protocol versions the typescript client and the electric server are using. Electric restricts connections from any client that does not use the same major protocol version. To troubleshoot this issue, you can verify the protocol files used by the client and server in these locations:

* `[typescript-client]/proto/satellite.proto`
* `[electric]/deps/satellite_proto/proto/satellite.proto`
