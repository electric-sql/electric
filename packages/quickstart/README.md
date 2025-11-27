# @electric-sql/quickstart

CLI package for the [ElectricSQL Quickstart](https://electric-sql.com/docs/quickstart).

## Usage

Create a new app using [Electric](https://electric-sql.com/product/electric) with [TanStack DB](https://tanstack.com/db), based on the [examples/tanstack-db-web-starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter) [TanStack Start](http://tanstack.com/start) template app:

```bash
pnpx @electric-sql/quickstart my-electric-app
```

This command will:

1. pull in the template app using gitpick
2. provision cloud resources
   - a Postgres database using Neon
   - an Electric sync service using Electric Cloud
   - fetch their access credentials
3. configure the local `.env` to use the credentials
4. add `psql`, `claim` and `deploy` commands to the package.json
   - also using the generated credentials

## Environment Variables

The CLI automatically generates these environment variables:

- `DATABASE_URL` - PostgreSQL connection string
- `ELECTRIC_SECRET` - Electric Cloud authentication secret
- `ELECTRIC_SOURCE_ID` - Electric sync service identifier

## Commands

```bash
pnpm dev          # Start development server
pnpm psql         # Connect to PostgreSQL database
pnpm claim        # Claim temporary resources
pnpm deploy       # Deploy to Netlify
```

### `pnpm psql`

Connect directly to your PostgreSQL database using the configured `DATABASE_URL`:

### `pnpm claim`

Claim temporary resources to move them to your permanent Electric Cloud and Neon accounts.

### `pnpm deploy`

Deploy your app to Netlify with all environment variables configured.

## Development

This package is part of the Electric monorepo. To work on it:

```bash
# From the monorepo root
pnpm install   # Install all workspace dependencies
pnpm build     # Build all packages

# From packages/quickstart
pnpm build     # Compile TypeScript
pnpm dev       # Build and test locally
```
