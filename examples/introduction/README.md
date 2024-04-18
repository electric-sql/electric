# ElectricSQL Introduction

This repo contains the source code for the demo apps / widgets on the [Introduction section](https://electric-sql.com/docs/intro/local-first) of the [ElectricSQL website](https://electric-sql.com).

## Usage

Install deps:

```sh
yarn
```

Start the electric service, migrate, and generate the client:

```sh
yarn backend:up
yarn db:migrate
yarn client:generate
```

If running outside of the context of the website repo, you will need to populate some environment variables in `src/config.ts`. These are normally injected by Webpack during the website build but this source repo uses Vite as its build process.

Boot up the dev server

```sh
yarn dev
```

You should be able to see the website demo widgets in an unstyled page at [http://localhost:5173](http://localhost:5173).

These are meant to be integrated within the website.
