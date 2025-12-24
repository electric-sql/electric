# TanStack Start + DB + Electric Starter

This is a TanStack Start project with tRPC v10 for mutations and Electric sync for reads, running on Start's server functions so it's easily deployable to many hosting platforms.

**Core Pattern**: Electric SQL for reads, tRPC for writes, TanStack DB for optimistic updates.

All reads from the Postgres database are done via the Electric sync engine. All mutations (create, update, delete) are done via tRPC with full end-to-end type safety.

We sync normalized data from tables into TanStack DB collections in the client & then write client-side queries for displaying data in components.

## General Usage

You MUST read https://electric-sql.com/AGENTS.md for general information on developing wth Electric and TanStack DB.

## Starter template specifics

You CAN choose to read the `README.md` for this project if useful. Much of it is summarized below.

### Pre-reqs

Docker, Caddy (with root cert installed using `caddy trust`), Node and pnpm. Versions in `.tool-versions`.

### Initial setup

```sh
pnpm install    # install deps
pnpm backend:up # run backend services using docker compose
pnpm migrate    # apply migrations
pnpm dev        # run dev server
```

The dev server runs over HTTPS via a CaddyPlugin in the vite config. This supports HTTP/2 which is essential to avoid slow shapes for Electric.

### Linting and formatting

Human devs have IDEs that autoformat code on every file save. After you edit files, you must do the equivalent by running `pnpm lint`.

This command will also report linter errors that were not automatically fixable. Use your judgement as to which of the linter violations should be fixed.

### Build/Test Commands

- `pnpm dev` - Start development server with Docker services
- `pnpm build` - Build for production
- `pnpm test` - Run all Vitest tests
- `vitest run <test-file>` - Run single test file
- `pnpm start` - Start production server

### Architecture

- **Frontend**: TanStack Start (SSR framework for React and other frameworks) with file-based routing in `src/routes/`
- **Database**: PostgreSQL with Drizzle ORM, schema in `src/db/schema.ts`
- **Electric**: Real-time sync service on port 30000
- **Services**: Docker Compose setup (Postgres on 54321, Electric on 30000)
- **Styling**: Tailwind CSS v4
- **Authentication**: better-auth
- **API**: tRPC v10 for mutations with full e2e type safety, Electric shapes for real-time reads

### API Routing

- **tRPC** (`/api/trpc/*`) - All mutations (create, update, delete) with full type safety
- **better-auth** (`/api/auth/*`) - Authentication endpoints
- **Electric shapes** (`/api/projects`, `/api/todos`, `/api/users`) - Real-time sync endpoints for reads

### Code Style

- **TypeScript**: Strict mode, ES2022 target, bundler module resolution
- **Imports**: Use `@/*` path aliases for `src/` directory imports
- **Components**: React 19 with JSX transform, functional components preferred
- **Server DB**: Drizzle ORM with PostgreSQL dialect, schema-first approach
- **Client DB**: TanStack DB with Electric Sync Collections
- **Routing**: File-based with TanStack Router, use `Link` component for navigation
- **Testing**: Vitest with @testing-library/react for component tests
- **file names** should always use kebab-case

### tRPC Integration

- tRPC routers are defined in `src/lib/trpc/` directory
- Client is configured in `src/lib/trpc-client.ts`
- Collection hooks use tRPC client for mutations in `src/lib/collections.ts`
- Transaction IDs are generated using `pg_current_xact_id()::xid::text` for Electric sync compatibility

### Data Flow Architecture

#### Reading Data (Electric SQL → TanStack DB)

```tsx
// 1. Preload in route loader
export const Route = createFileRoute('/todos/')({
  loader: async () => {
    await Promise.all([
      todosCollection.preload(),
      projectsCollection.preload(), // Include if used by child components
    ])
  },
})

// 2. Query with useLiveQuery (ALWAYS destructure data)
const { data: todos } = useLiveQuery(
  (q) => q.from({ todosCollection }).where(...),
  [dependencies] // Include reactive dependencies
)
```

#### Writing Data (TanStack DB → tRPC)

```tsx
// Use collection operations for optimistic updates
todosCollection.insert({ ... })  // NOT trpc.todos.create.mutate()
// Similar to Immer
todosCollection.update(id, (draft) => { ... })
todosCollection.delete(id)
```

#### Collection Definition Pattern

```tsx
// src/lib/collections.ts
export const todosCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    shapeOptions: { url: '/api/todos', ... },
    schema: selectTodosSchema,
    getKey: (item) => item.id,

    // tRPC handlers (CRUD only, return { txid })
    onInsert: async ({ transaction }) => {
      const result = await trpc.todos.create.mutate(...)
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => { ... },
    onDelete: async ({ transaction }) => { ... },
  })
)
```

### Critical Rules

1. **NEVER use tRPC for data reads** - Only Electric SQL + useLiveQuery
2. **NEVER call tRPC directly from components** - Use collection operations
3. **NEVER use TanStack Query** - This uses TanStack DB (different library)
4. **ALWAYS preload collections** in route loaders
5. **ALWAYS use snake_case** for database fields throughout the app
6. **ONLY basic CRUD in tRPC** - No special mutations unless using `createOptimisticAction`

### Naming Conventions

- **Database**: snake_case (e.g., `user_id`, `created_at`)
- **Files**: kebab-case (e.g., `todo-card.tsx`)
- **Routes**: Use `_` prefix for pathless layouts (e.g., `_authenticated.tsx`)

### Schema Management

```tsx
// src/db/zod-schemas.ts (centralized, never redefine)
export const selectTodoSchema = createSelectSchema(todos)
export const insertTodoSchema = createInsertSchema(todos)
export const updateTodoSchema = createUpdateSchema(todos)
```

### Component Patterns

- **Forms**: Use optimistic updates, no loading states needed
- **Links**: Use TanStack Router's `Link` component
- **Auth**: Access via `authClient.useSession()`
