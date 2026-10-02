# @electric-sql/start

CLI package for the [ElectricSQL Quickstart](https://electric-sql.com/docs/quickstart).

## Usage

Create a new app using [Electric](https://electric-sql.com/product/electric) with [TanStack DB](https://tanstack.com/db), based on the [examples/tanstack-db-web-starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter) [TanStack Start](http://tanstack.com/start) template app:

```bash
npx @electric-sql/start my-electric-app
```

This command will:

1. pull in the template app using gitpick
2. generate a `.env` file configured for the local Postgres and Electric services defined in the template's `docker-compose.yaml`
3. install the dependencies with `pnpm install`

To configure an existing copy of the template in the current directory instead, run:

```bash
npx @electric-sql/start .
```

## Prerequisites

- [Docker](https://www.docker.com) to run Postgres and Electric locally
- [Caddy](https://caddyserver.com) to serve the dev server over HTTPS (see the template's README)
- [Node](https://nodejs.org/en) with [pnpm](https://pnpm.io)

## Next steps

Once the CLI completes, start the backend services, apply the migrations and run the app:

```bash
cd my-electric-app
pnpm backend:up   # Start Postgres and Electric in Docker
pnpm migrate      # Apply database migrations
pnpm dev          # Start the dev server on https://localhost:5173
```

## Environment Variables

The CLI generates a `.env` file with:

- `DATABASE_URL` - connection string for the local Postgres (`localhost:54321`)
- `ELECTRIC_URL` - URL of the local Electric sync service (`http://localhost:30000`)
- `BETTER_AUTH_SECRET` - a randomly generated authentication secret

## Commands

```bash
pnpm dev             # Start development server
pnpm migrate         # Apply database migrations
pnpm psql            # Connect to the PostgreSQL database
pnpm backend:up      # Start Postgres and Electric
pnpm backend:down    # Stop Postgres and Electric
pnpm backend:clear   # Stop Postgres and Electric and delete their data
```

## Development

This package is part of the Electric monorepo. To work on it:

```bash
# From the monorepo root
pnpm install   # Install all workspace dependencies

# From packages/start
pnpm build     # Compile TypeScript
pnpm test      # Run the tests
```
