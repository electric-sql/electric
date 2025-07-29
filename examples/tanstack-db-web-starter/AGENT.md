# TanStack Start + DB + Electric Starter

This is a TanStack Start project with tRPC v10 for mutations and Electric sync for reads, running on Start's server functions so it's easily deployable to many hosting platforms.

All reads from the Postgres database are done via the Electric sync engine. All mutations (create, update, delete) are done via tRPC with full end-to-end type safety.

We sync normalized data from tables into TanStack DB collections in the client & then write client-side queries for displaying data in components.

## Initial setup

Before you started, all necessary package install is done via `pnpm install` and a dev server is started with `pnpm dev`.

## Linting and formatting

Human devs have IDEs that autoformat code on every file save. After you edit files, you must do the equivalent by running `pnpm lint`.

This command will also report linter errors that were not automatically fixable. Use your judgement as to which of the linter violations should be fixed.

## Build/Test Commands

- `pnpm run dev` - Start development server with Docker services
- `pnpm run build` - Build for production
- `pnpm run test` - Run all Vitest tests
- `vitest run <test-file>` - Run single test file
- `pnpm run start` - Start production server

## Architecture

- **Frontend**: TanStack Start (SSR framework for React and other frameworks) with file-based routing in `src/routes/`
- **Database**: PostgreSQL with Drizzle ORM, schema in `src/db/schema.ts`
- **Electric**: Real-time sync service on port 3000
- **Services**: Docker Compose setup (Postgres on 54321, Electric on 3000)
- **Styling**: Tailwind CSS v4
- **Authentication**: better-auth
- **API**: tRPC v10 for mutations with full e2e type safety, Electric shapes for real-time reads

## API Routing

- **tRPC** (`/api/trpc/*`) - All mutations (create, update, delete) with full type safety
- **better-auth** (`/api/auth/*`) - Authentication endpoints
- **Electric shapes** (`/api/projects`, `/api/todos`, `/api/users`) - Real-time sync endpoints for reads

## Code Style

- **TypeScript**: Strict mode, ES2022 target, bundler module resolution
- **Imports**: Use `@/*` path aliases for `src/` directory imports
- **Components**: React 19 with JSX transform, functional components preferred
- **Server DB**: Drizzle ORM with PostgreSQL dialect, schema-first approach
- **Client DB**: TanStack DB with Electric Sync Collections
- **Routing**: File-based with TanStack Router, use `Link` component for navigation
- **Testing**: Vitest with @testing-library/react for component tests
- **file names** should always use kebab-case

## tRPC Integration

- tRPC routers are defined in `src/lib/trpc/` directory
- Client is configured in `src/lib/trpc-client.ts`
- Collection hooks use tRPC client for mutations in `src/lib/collections.ts`
- Transaction IDs are generated using `pg_current_xact_id()::xid::text` for Electric sync compatibility
