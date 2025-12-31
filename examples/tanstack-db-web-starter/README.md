Welcome to your new TanStack [Start](https://tanstack.com/start/latest) / [DB](https://tanstack.com/db/latest) + [Electric](https://electric-sql.com/) app!

# Getting started

## Pre-requisites

You need:

- [Docker](https://www.docker.com)
- [Caddy](https://caddyserver.com)
- [Node](https://nodejs.org/en) with [pnpm](https://pnpm.io)

You can see compatible versions in the `.tool-versions` file.

### Docker

Make sure you have [Docker](https://www.docker.com) running. Docker is used to run the [Postgres](https://www.postgresql.org) and [Electric](https://electric-sql.com) services defined in `docker-compose.yaml`.

### Caddy

Make sure you have [Caddy installed](https://caddyserver.com/docs/install) and have [installed its root certificate](https://caddyserver.com/docs/command-line#caddy-trust) using:

```sh
caddy trust # may require sudo
```

Electric [benefits significantly from `HTTP/2` multiplexing](https://electric-sql.com/docs/guides/troubleshooting#slow-shapes-mdash-why-are-my-shapes-slow-in-the-browser-in-local-development). `HTTP/2` requires `HTTPS`. Caddy is necessary for `HTTPS` to work in local development.

## Quickstart

Create a new project based on this starter:

```sh
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-tanstack-db-project
cd my-tanstack-db-project
```

Copy the `.env.example` file to `.env`:

```sh
cp .env.example .env
```

> [!Tip]
> You can edit the values in the `.env` file. The default values are configured for local development with Docker. You can run against a different Postgres and Electric, for example using the Electric Cloud, by changing the `DATABASE_URL` and `ELECTRIC_URL`.

Install the dependencies:

```sh
pnpm install
```

Start the backend services (Postgres and Electric) running in the background using Docker:

```sh
pnpm backend:up
```

Apply the database migrations:

```sh
pnpm migrate
```

Start the dev server:

```sh
pnpm dev
```

Open the application on [https://localhost:5173](https://localhost:5173).

> [!Tip]
> If you run into any issues, see the [troubleshooting](#troubleshooting) section below.

# How Authentication Works

This starter implements a secure authentication pattern for Electric sync. If you're new to Electric, it's worth understanding how the pieces fit together since this is a novel part of the stack.

## Overview

Electric is a Postgres sync engine that streams data to clients via HTTP. Unlike traditional REST APIs where each request is authenticated individually, Electric maintains persistent sync connections. This requires a different approach to authorization.

The starter uses a **Shape Proxy Pattern** where:

1. Users authenticate with [Better Auth](https://www.better-auth.com/) (session cookies)
2. API routes validate the session before proxying requests to Electric
3. Row-level filtering ensures users only see their own data
4. tRPC mutations re-validate permissions server-side

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (Browser)                        │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  TanStack DB │    │   Electric   │    │    tRPC      │  │
│  │  Collection  │───▶│ Shape Client │    │   Client     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                    │          │
└─────────│───────────────────│────────────────────│──────────┘
          │                   │                    │
          │    Session Cookie │ (automatic)        │
          │                   ▼                    ▼
┌─────────│───────────────────────────────────────────────────┐
│         │           Server (TanStack Start)                  │
│         │                                                    │
│         │    ┌────────────────────────────────────────────┐ │
│         │    │           Shape Proxy Routes               │ │
│         │    │     (/api/todos, /api/projects, etc)       │ │
│         │    │                                            │ │
│         │    │  1. Validate session                       │ │
│         │    │  2. Add WHERE user_id = ?                  │ │
│         │    │  3. Forward to Electric                    │ │
│         │    └────────────────────────────────────────────┘ │
│         │                         │                         │
│         │    ┌────────────────────│───────────────────────┐ │
│         │    │  tRPC Router       ▼                       │ │
│         └───▶│  - Validates session                       │ │
│              │  - Checks ownership before mutations       │ │
│              │  - Returns transaction IDs for sync        │ │
│              └────────────────────────────────────────────┘ │
│                                   │                         │
└───────────────────────────────────│─────────────────────────┘
                                    │
                   ┌────────────────┴────────────────┐
                   ▼                                 ▼
            ┌──────────┐                      ┌──────────┐
            │ Electric │                      │ Postgres │
            │  Server  │◀────────────────────▶│ Database │
            └──────────┘                      └──────────┘
```

## Shape Proxy Routes

Each table that syncs via Electric has a corresponding API route that acts as an authenticated proxy. Here's what happens in `/api/todos`:

```typescript
const serve = async ({ request }: { request: Request }) => {
  // 1. Validate the session
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    })
  }

  // 2. Build the Electric URL with row-level filtering
  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set("table", "todos")
  // Only sync rows where the user has access
  const filter = `'${session.user.id}' = ANY(user_ids)`
  originUrl.searchParams.set("where", filter)

  // 3. Proxy the request to Electric
  return proxyElectricRequest(originUrl)
}
```

This pattern ensures:

- **Electric never receives unauthenticated requests** - the proxy validates first
- **Users only see their own data** - the `WHERE` clause filters at the database level
- **Session cookies work automatically** - no special client configuration needed

## Mutation Authorization

While Electric handles reads, mutations go through tRPC with additional authorization:

```typescript
// src/lib/trpc/todos.ts
delete: authedProcedure
  .input(deleteTodoSchema)
  .mutation(async ({ ctx, input }) => {
    // Find the todo first
    const [todo] = await ctx.db.select().from(todosTable).where(eq(id, input.id))

    // Verify the user has access
    if (!todo.user_ids.includes(ctx.session.user.id)) {
      throw new TRPCError({ code: "FORBIDDEN" })
    }

    // Proceed with deletion
    // ...
  })
```

## Adding Auth to New Tables

When you add a new table (see [Adding a New Table](#adding-a-new-table)), you need to:

1. **Include a user reference** in your schema (e.g., `user_id` column)
2. **Create a shape proxy route** that validates the session and filters by user
3. **Add ownership checks** in your tRPC mutations

The "Adding a New Table" section below shows the complete pattern.

## Learn More

For more details on Electric's authentication model, see:

- [Electric Auth Guide](https://electric-sql.com/docs/guides/auth) - comprehensive auth documentation
- [Electric Shapes](https://electric-sql.com/docs/guides/shapes) - how partial replication works

# Naming Conventions

This starter uses **snake_case** for all database column names. This is the PostgreSQL convention and is important for consistency with Electric.

## Why snake_case?

1. **PostgreSQL convention** - snake_case is the standard naming convention for PostgreSQL columns
2. **Electric compatibility** - Electric syncs data using the exact column names from your database
3. **Consistency** - keeping names the same from database to frontend reduces confusion

## Column naming in practice

When defining Drizzle schemas, use snake_case for column names:

```ts
// src/db/schema.ts
export const todosTable = pgTable("todos", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  text: varchar({ length: 500 }).notNull(),
  completed: boolean().notNull().default(false),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(), // snake_case
  user_id: text("user_id").notNull(), // snake_case
  project_id: integer("project_id").notNull(), // snake_case
})
```

Your TypeScript types and Zod schemas will then also use snake_case:

```ts
type Todo = {
  id: number
  text: string
  completed: boolean
  created_at: Date // matches database
  user_id: string // matches database
  project_id: number // matches database
}
```

## Using camelCase instead

If you prefer camelCase in your TypeScript code, Electric provides a `columnMapper` option that automatically transforms column names:

```ts
import { ShapeStream, snakeCamelMapper } from "@electric-sql/client"

const stream = new ShapeStream<Todo>({
  url: "http://localhost:3000/v1/shape",
  params: { table: "todos" },
  columnMapper: snakeCamelMapper(), // created_at → createdAt
})
```

The mapper also handles where clauses, so `where: "userId = $1"` becomes `user_id = $1` when sent to Electric.

See the [Electric TypeScript client docs](https://electric-sql.com/docs/api/clients/typescript#column-mapping) for more details.

# Developing your app

## Adding a New Table

Here's how to add a new table to your app (using a "categories" table as an example):

### 1. Define the Drizzle schema

Add your table to `src/db/schema.ts`:

```tsx
export const categoriesTable = pgTable("categories", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  color: varchar({ length: 7 }), // hex color
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
})

// Add Zod schemas
export const selectCategorySchema = createSelectSchema(categoriesTable)
export const createCategorySchema = createInsertSchema(categoriesTable).omit({
  created_at: true,
})
export const updateCategorySchema = createUpdateSchema(categoriesTable)
```

### 2. Generate and run migrations

```sh
# Generate migration file
pnpm migrate:generate

# Apply migration to database
pnpm migrate
```

### 3. Expose an Electric shape route

Create `src/routes/api/categories.ts`:

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/lib/auth"
import { prepareElectricUrl, proxyElectricRequest } from "@/lib/electric-proxy"

const serve = async ({ request }: { request: Request }) => {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set("table", "categories")
  // Filter to user's own categories
  const filter = `user_id = '${session.user.id}'`
  originUrl.searchParams.set("where", filter)

  return proxyElectricRequest(originUrl)
}

export const Route = createFileRoute("/api/categories")({
  server: {
    handlers: {
      GET: serve,
    },
  },
})
```

### 4. Add a tRPC router

Create `src/lib/trpc/categories.ts`:

```tsx
import { router, authedProcedure, generateTxId } from "@/lib/trpc"
import { z } from "zod"
import { eq, and } from "drizzle-orm"
import {
  categoriesTable,
  createCategorySchema,
  updateCategorySchema,
} from "@/db/schema"

export const categoriesRouter = router({
  create: authedProcedure
    .input(createCategorySchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [newItem] = await tx
          .insert(categoriesTable)
          .values({ ...input, user_id: ctx.session.user.id })
          .returning()
        return { item: newItem, txid }
      })
      return result
    }),

  // Add update and delete following the same pattern...
})
```

### 5. Wire up the tRPC router

Add to `src/routes/api/trpc/$.ts`:

```tsx
import { categoriesRouter } from "./trpc/categories"

export const appRouter = router({
  // ... existing routers
  categories: categoriesRouter,
})
```

### 6. Add a TanStack DB collection

Add to `src/lib/collections.ts`:

```tsx
export const categoriesCollection = createCollection(
  electricCollectionOptions({
    id: "categories",
    shapeOptions: {
      url: "/api/categories",
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },
    schema: selectCategorySchema,
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newCategory } = transaction.mutations[0]
      const result = await trpc.categories.create.mutate({
        name: newCategory.name,
        color: newCategory.color,
      })
      return { txid: result.txid }
    },
    // Add onUpdate, onDelete as needed
  })
)
```

### 7. Use the collection in your routes

Preload in route loaders and use with `useLiveQuery`:

```tsx
// In route loader
export const Route = createFileRoute("/my-route")({
  loader: async () => {
    await Promise.all([categoriesCollection.preload()])
  },
})

// In component
const { data: categories } = useLiveQuery((q) =>
  q.from({ categoriesCollection }).orderBy(/* ... */)
)
```

That's it! Your new table is now fully integrated with Electric sync, tRPC mutations, and TanStack DB queries.

## Notes

### About Caddy

Electric SQL's shape delivery benefits significantly from **HTTP/2 multiplexing**. Without HTTP/2, each shape subscription creates a new HTTP/1.1 connection, which browsers limit to 6 concurrent connections per domain. This creates a bottleneck that makes shapes appear slow.

Caddy provides HTTP/2 support with automatic HTTPS, giving you:

- **Faster shape loading** - Multiple shapes load concurrently over a single connection
- **Better development experience** - No connection limits or artificial delays
- **Production-like performance** - Your local dev mirrors production HTTP/2 behavior

The Vite development server runs on HTTP/1.1 only, so Caddy acts as a reverse proxy to upgrade the connection.

#### Setup

Once you've [installed Caddy](https://caddyserver.com/docs/install), install its root certificate using:

```sh
caddy trust
```

This is necessary for HTTP/2 to work [without SSL warnings/errors in the browser](https://caddyserver.com/docs/command-line#caddy-trust).

#### How It Works

- Caddy auto-starts via a Vite plugin when you run `pnpm dev`
- The `Caddyfile` is automatically generated with your project name
- Your app is available at `https://<project-name>.localhost`
- Direct access to `http://localhost:5173` still works but will be slower for Electric shapes

#### Troubleshooting Caddy

If Caddy fails to start:

1. **Test Caddy manually:**

   ```sh
   caddy start
   ```

2. **Check certificate trust:**

   ```sh
   caddy trust
   # To remove later: caddy untrust
   ```

3. **Verify Caddyfile was generated:**
   Look for a `Caddyfile` in your project root after running `pnpm dev`

4. **Stop conflicting Caddy instances:**

   ```sh
   caddy stop
   ```

5. **Check for port conflicts:**
   Caddy needs ports 80 and 443 available

## Troubleshooting

### Common Pitfalls

| Issue                    | Symptoms                                    | Solution                                                           |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------ |
| **Docker not running**   | `docker compose ps` shows nothing           | Start Docker Desktop/daemon                                        |
| **Caddy not trusted**    | SSL warnings in browser                     | Run `caddy trust` (see Caddy section below)                        |
| **Port conflicts**       | Postgres (54321) or Electric (30000) in use | Stop conflicting services or change ports in `docker-compose.yaml` |
| **Missing .env**         | Database connection errors                  | Copy `.env.example` to `.env`                                      |
| **Caddy fails to start** | `Caddy exited with code 1`                  | Run `caddy start` manually to see the error                        |

### Debugging Commands

For troubleshooting, these commands are helpful:

```sh
# Check Docker services status
docker compose ps

# View Electric and Postgres logs
docker compose logs -f electric postgres

# Test database connectivity
psql $DATABASE_URL -c "SELECT 1"

# Check Caddy status
caddy start
```

## Building For Production

To build this application for production:

```bash
pnpm build
```

### Production Deployment Checklist

Before deploying to production, ensure you have configured:

#### Required Environment Variables

```bash
# Authentication - REQUIRED in production
BETTER_AUTH_SECRET=your-secret-key-here

# Electric Cloud (if using hosted Electric)
ELECTRIC_SOURCE_ID=your-source-id
ELECTRIC_SOURCE_SECRET=your-source-secret

# Database (adjust for your production database)
DATABASE_URL=postgresql://user:pass@your-prod-db:5432/dbname
```

#### Authentication Setup

**⚠️ Important**: The current setup allows any email/password combination to work in development. This is **automatically disabled** in production, but you need to:

1. **Configure proper auth providers** in `src/lib/auth.ts` (Google, GitHub, etc.)
2. **Remove or secure the dev-only email/password auth** if you plan to use it
3. **Review `trustedOrigins`** settings for your production domains

#### Infrastructure Changes

- **HTTPS & Secure Cookies**: Ensure your deployment platform handles HTTPS termination
- **Database**: Use a managed PostgreSQL service (not the Docker container)
- **Environment**: Set `NODE_ENV=production`

#### Security Considerations

- Generate a strong `BETTER_AUTH_SECRET` (minimum 32 characters)
- Ensure database credentials are properly secured
- Review CORS settings if serving from different domains
- Verify that dev-mode authentication patterns are disabled

## AI

The starter includes an `AGENTS.md`. Depending on which AI coding tool you use, you may need to copy/move it to the right file name e.g. `.cursor/rules`.

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

## Routing

This project uses [TanStack Router](https://tanstack.com/router). The initial setup is a file based router. Which means that the routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add another a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router"
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you use the `<Outlet />` component.

Here is an example layout that includes a header:

```tsx
import { Outlet, createRootRoute } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"

import { Link } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: () => (
    <>
      <header>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
        </nav>
      </header>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
})
```

The `<TanStackRouterDevtools />` component is not required so you can remove it if you don't want it in your layout.

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack DB to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people",
  loader: async () => {
    const response = await fetch("https://swapi.dev/api/people")
    return response.json() as Promise<{
      results: {
        name: string
      }[]
    }>
  },
  component: () => {
    const data = peopleRoute.useLoaderData()
    return (
      <ul>
        {data.results.map((person) => (
          <li key={person.name}>{person.name}</li>
        ))}
      </ul>
    )
  },
})
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

### TanStack DB & Electric

TanStack DB gives you robust support for real-time sync, live queries and local writes. With no stale data, super fast re-rendering and sub-millisecond cross-collection queries — even for large complex apps.

[Electric](https://electric-sql.com/) is a Postgres sync engine. It solves the hard problems of sync for you, including [partial replication](https://electric-sql.com/docs/guides/shapes), [fan-out](https://electric-sql.com/docs/api/http#caching), and [data delivery](https://electric-sql.com/docs/api/http).

Built on a TypeScript implementation of differential dataflow, TanStack DB provides:

- 🔥 **Blazing fast query engine** - sub-millisecond live queries, even for complex queries with joins and aggregates
- 🎯 **Fine-grained reactivity** - minimize component re-rendering
- 💪 **Robust transaction primitives** - easy optimistic mutations with sync and lifecycle support
- 🌟 **Normalized data** - keep your backend simple

#### Core Concepts

**Collections** - Typed sets of objects that can mirror a backend table or be populated with filtered views like `pendingTodos` or `decemberNewTodos`. Collections are just JavaScript data that you can load on demand.

**Live Queries** - Run reactively against and across collections with support for joins, filters and aggregates. Powered by differential dataflow, query results update incrementally without re-running the whole query.

**Transactional Optimistic Mutations** - Batch and stage local changes across collections with immediate application of local optimistic updates. Sync transactions to the backend with automatic rollbacks and management of optimistic state.

#### Usage with ElectricSQL

This starter proxies ElectricSQL shapes through server routes for auth-aware filtering. Use the proxied endpoints in `shapeOptions.url`:

```tsx
import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"

export const todoCollection = createCollection(
  electricCollectionOptions<Todo>({
    id: "todos",
    schema: todoSchema,
    // Electric syncs data using "shapes" - filtered views on database tables
    shapeOptions: {
      url: "/api/todos",
      parser: {
        timestamptz: (s: string) => new Date(s),
      },
    },
    getKey: (item) => item.id,
    onInsert: async ({ transaction }) => {
      const { modified: newTodo } = transaction.mutations[0]
      const result = await trpc.todos.create.mutate({
        text: newTodo.text,
        completed: newTodo.completed,
        // ... other fields
      })
      return { txid: result.txid }
    },
    // You can also implement onUpdate, onDelete as needed
  })
)
```

Apply mutations with local optimistic state that automatically syncs:

```tsx
const AddTodo = () => {
  return (
    <Button
      onClick={() =>
        todoCollection.insert({
          id: crypto.randomUUID(),
          text: "🔥 Make app faster",
          completed: false,
        })
      }
    />
  )
}
```

#### Live Queries with Cross-Collection Joins

Use live queries to read data reactively across collections:

```tsx
import { useLiveQuery, eq } from "@tanstack/react-db"

const Todos = () => {
  // Read data using live queries with cross-collection joins
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .join({ list: listCollection }, ({ list, todo }) =>
        eq(list.id, todo.list_id)
      )
      .where(({ list }) => eq(list.active, true))
      .select(({ list, todo }) => ({
        id: todo.id,
        status: todo.status,
        text: todo.text,
        list_name: list.name,
      }))
  )

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>
          {todo.text} - {todo.name}
        </li>
      ))}
    </ul>
  )
}
```

This pattern provides blazing fast, cross-collection live queries and local optimistic mutations with automatically managed optimistic state, all synced in real-time with ElectricSQL.

#### tRPC Integration for Mutations

This starter uses [tRPC v10](https://trpc.io/) for type-safe mutations while Electric handles real-time reads:

```tsx
// src/lib/trpc-client.ts
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client"
import type { AppRouter } from "@/routes/api/trpc/$"

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      async headers() {
        return {
          cookie: typeof document !== "undefined" ? document.cookie : "",
        }
      },
    }),
  ],
})
```

The collection hooks use tRPC for all mutations, providing full end-to-end type safety:

```tsx
// In your collection configuration
onUpdate: async ({ transaction }) => {
  const { modified: updatedTodo } = transaction.mutations[0]
  const result = await trpc.todos.update.mutate({
    id: updatedTodo.id,
    data: {
      text: updatedTodo.text,
      completed: updatedTodo.completed,
    },
  })
  return { txid: result.txid }
},
```

**API Routes:**

- `/api/trpc/*` - tRPC mutations with full type safety
- `/api/auth/*` - Authentication via better-auth
- `/api/projects`, `/api/todos`, `/api/users` - Electric sync shapes for reads

### Core Architecture Rules

Follow these patterns to get the most out of this starter:

- **Use Electric for reads** - `useLiveQuery` with collections, not tRPC queries
- **Use collection operations for writes** - Call `collection.insert()`, not `trpc.create.mutate()` directly
- **Preload collections in route loaders** - Prevents loading flicker and ensures data availability

#### Why These Rules Matter

- **Electric handles reads** - Direct tRPC reads bypass real-time sync and optimistic updates
- **Collection operations are optimistic** - They update the UI immediately while syncing in the background
- **Preloading prevents flicker** - Collections load before components render, ensuring data is available

# Learn More

- [TanStack documentation](https://tanstack.com)
- [TanStack DB documentation](https://tanstack.com/db/latest/docs/overview)
- [An Interactive Guide to TanStack DB](https://frontendatscale.com/blog/tanstack-db)
- [Stop Re-Rendering — TanStack DB, the Embedded Client Database for TanStack Query](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query)
- [Local-first sync with TanStack DB and Electric](https://electric-sql.com/blog/2025/07/29/local-first-sync-with-tanstack-db)
