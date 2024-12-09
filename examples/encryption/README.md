
# Encryption example

This is an example of encryption with Electric. It's a React app with a very simple Express API server.

The Electric-specific code is in [`./src/Example.tsx`](./src/Example.tsx). It demonstrates:

- encrypting data before sending to the API server
- decrypting data after it syncs in through Electric

## Setup

This example is part of the [ElectricSQL monorepo](../..) and is designed to be built and run as part of the [pnpm workspace](https://pnpm.io/workspaces) defined in [`../../pnpm-workspace.yaml`](../../pnpm-workspace.yaml).

Navigate to the root directory of the monorepo, e.g.:

```shell
cd ../../
```

Install and build all of the workspace packages and examples:

```shell
pnpm install
pnpm run -r build
```

Navigate back to this directory:

```shell
cd examples/encryption
```

Start the example backend services using [Docker Compose](https://docs.docker.com/compose/):

```shell
pnpm backend:up
```

Now start the dev server:

```shell
pnpm dev
```

Open [localhost:5173]http://localhost:5173] in your web browser. When you add items, the plaintext is encrypted before it leaves the app. You can see the ciphertext in Postgres, e.g.:

```console
$ psql "postgresql://postgres:password@localhost:54321/electric"
psql (16.4)
Type "help" for help.

electric=# select * from items;
                  id                  |          ciphertext          |        iv
--------------------------------------+------------------------------+------------------
 491b2654-5714-48bb-a206-59f87a2dc33c | vDwv3IX5AGXJVi2jNJJDPE25MwiS | 0gwdqHvqiJ8lJqaS
(1 row)
```

When you're done, stop the backend services using:

```shell
pnpm backend:down
```