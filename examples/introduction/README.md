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

If running outside of the context of the website repo, you will need to ensure the configuration replacement variables in`vite.config.ts`'s `define` object are set correctly.

Boot up the dev server

```sh
yarn dev
```

You should be able to see the website demo widgets in an unstyled page at [http://localhost:5173](http://localhost:5173).

If you see API request failures in the browser console, that's expected when this example is running outside of the context of the (private) website repo. These are meant to be integrated within the codebase of the website repo that powers https://electric-sql.com.
