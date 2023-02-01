# Fully local development against ElectricSQL stack

## Running a local stack

Electric services are packaged as docker containers. They can be ran locally using the `docker-compose.yaml` file in this directory:

```bash
# Use environment variables from `.envrc` file
source .envrc
docker-compose up
```

This starts 4 containers: Postgres (exposes port 5432 for connections), Vaxine, Electric (exposes port 5133 for websocket connections), and local Console (exposes port 4000 for HTTP connections). Local console is required to emulate interaction with the ElectricSQL Cloud when using the CLI tooling. You might encounter errors if any of the specified ports are already taken on your machine - just edit the port binds and keep the new values in mind.

## Developing against the local stack

### CLI

You should have Electric CLI tool already installed. If not, follow [the docs](https://electric-sql.com/docs/usage/install). To run CLI against the local console, set the `ELECTRIC_CONSOLE_URL` environment variable to point to the exposed port of the local console (e.g. `export ELECTRIC_CONSOLE_URL=http://127.0.0.1:4000`), or export variables defined in the `.envrc` file to use the defaults: `source .envrc`.

CLI usage against the local console is limited (i.e. no account or app management), but all the commands with migration generation & sync will work. One exception is that when running `electric init <app>`, you should run `electric init <app> --no-verify` since app concept is meaningless when running only a single instance locally.

### Typescript client

Typescript client also requires configuration to use local console and local electric. In your electrified app folder, run:
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
electric build
```