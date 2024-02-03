---
title: Typescript client
description: >-
  Generate a local database client as part of your build process.

sidebar_position: 50
---

Install the [`electric-sql`](https://www.npmjs.com/package/electric-sql) library and [`npx electric-sql generate`](../../api/cli.md#generate) your database [Client](../data-access/client.md).

## Install

### Npm

Install the published [TypeScript client](https://www.npmjs.com/package/electric-sql) and [generator](https://www.npmjs.com/package/@electric-sql/prisma-generator):

```shell
npm install electric-sql
```

### GitHub

The source code is in the [clients/typescript](https://github.com/electric-sql/electric/tree/main/clients/typescript) subfolder of the [electric-sql/electric](https://github.com/electric-sql/electric) repo.

<!--

Install, for example, using [GitPkg](https://gitpkg.vercel.app):

```shell
npm install 'https://gitpkg.now.sh/electric-sql/electric/clients/typescript?main'
```

Or in development you can also use [Yalc](https://github.com/wclr/yalc):

<details>
  <summary>
    Show instructions
  </summary>
  <div>

[Yalc](https://github.com/wclr/yalc) is sometimes useful to install from a local clone when you're working on the Typescript client package.

For example:

```shell
git clone git@github.com:electric-sql/electric.git
cd electric/clients/typescript
pnpm i
yalc publish
```

Then in your app folder:

```shell
yalc add electric-sql
```

Then if you change the Typescript client source code (back in the `electric/clients/typescript` folder) run:

```shell
yalc push
```

Your local app will pick up the changes.

  </div>
</details>

-->

## Generate

Use the [Generator command](../../api/cli.md#generate) to generate a type-safe database client. First, make sure your [sync service is running](./service.md).

Then run:

```shell
npx electric-sql generate
```

By default this will connect to the [sync service](./service.md) on `http://localhost:5133` and output generated files to a `./src/generated/client` folder.

See <DocPageLink path="api/cli#generate" /> for the command-line options.

### Outputs

The generator command outputs a database schema, type-safe database client and bundled SQL migrations. See <DocPageLink path="usage/data-access/client" /> for details on how to import and use these when instantiating a database client.

### Pre-build script

You can wire up the generator to run every time you build your app by adding a `prebuild` script to your `package.json`:

```json
"scripts": {
  "prebuild": "npx electric-sql generate"
  // ...
}
```

### Watch mode

Or you can run the generator in `--watch` mode:

```shell
npx electric-sql generate --watch
```

This monitors the sync service to pick up on database schema changes and automatically re-generate the client whenever the [DDL schema](../data-modelling/migrations.md) or [DDLX rules](../../api/ddlx.md) change.
