
# Experimental TypeScript features for ElectricSQL

## Install

The client is published on NPM as [`@electric-sql/experimental`](https://www.npmjs.com/package/@electric-sql/experimental):

```sh
npm i @electric-sql/experimental
```

## Develop

Install the pnpm workspace at the repo root:

```shell
pnpm install
```

Build the package:

```shell
cd packages/typescript-client
pnpm build
```

## Test

In one terminal, start the backend running:

```shell
cd ../sync-service
mix deps.get
mix stop_dev && mix compile && mix start_dev && ies -S mix
```

Then in this folder:

```shell
pnpm test
```
