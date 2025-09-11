Welcome to your new TanStack [Start](https://tanstack.com/start/latest) / [DB](https://tanstack.com/db/latest) + [Electric](https://electric-sql.com/) app!

# Getting Started

## Create a new project

To create a new project based on this starter, run the following commands:

```sh
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-tanstack-db-project
cd my-tanstack-db-project
```

Copy the `.env.example` file to `.env`:

```sh
cp .env.example .env
```

_You can edit the values in the `.env` file, although the default values are fine for local development (with the `DATABASE_URL` defaulting to the development Postgres docker container and the `BETTER_AUTH_SECRET` not required)._

## Quickstart

Follow these steps in order for a smooth first-time setup:

1. **Install dependencies:**

   ```sh
   pnpm install
   ```

1. **Setup HTTPS:**

   ```sh
   pnpm trust
   ```

   This installs a certificate so you can [use HTTPS in development](#https-in-development).

1. **Start Docker services:**

   ```sh
   pnpm run dev
   ```

   This starts the Vite dev server and Docker Compose (Postgres + Electric).

1. **Run database migrations** (in a new terminal):

   ```sh
   pnpm run migrate
   ```

1. **Visit the application:**

   Open [https://localhost:5173](https://localhost:5173) in your web browser.

If you run into issues, see the [pre-reqs](#pre-requisites) and [troubleshooting](#common-pitfalls) sections below.

## Extending the app

Here's how to add a new table to your app (using a "categories" table as an example) and wire it up:

### 1. Define Drizzle schema

Define a [Drizzle table schema](https://orm.drizzle.team/docs/sql-schema-declaration#shape-your-data-schema) in `src/db/schema.ts`:

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

### 2. Migrate database

Generate a migration file:

```sh
pnpm migrate:generate
```

Apply the migration to the database:

```sh
pnpm migrate
```

### 3. Expose read-path sync

Create `src/routes/api/categories.ts` to expose read-path sync access to the categories table via a TanStack Start [server route](https://tanstack.com/start/latest/docs/framework/react/server-routes) that proxies to [an Electric shape](https://electric-sql.com/docs/guides/shapes):

```tsx
import { createServerFileRoute } from "@tanstack/react-start/server"
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

export const ServerRoute = createServerFileRoute("/api/categories").methods({
  GET: serve,
})
```

### 4. Handle writes using a tRPC mutation proceedure

Create `src/lib/trpc/categories.ts` to expose a type-safe [tRPC](https://trpc.io) [mutation proceedure](https://trpc.io/docs/server/procedures) to handle writes:

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

Add an  `categoriesCollection` to the TanStack DB `src/lib/collections.ts`, using:

- [`electricCollectionOptions`](https://tanstack.com/db/latest/docs/collections/electric-collection) to sync the data into the collection from the Electric shape route
- [`onInsert`, etc. operation handlers](https://tanstack.com/db/latest/docs/overview#making-optimistic-mutations) to handle local optimistic writes using the tRPC mutation proceedure

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

### 7. Preload in your routes

You can preload collections in your [route loaders](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading):

```tsx
// In route loader
export const Route = createFileRoute("/my-route")({
  loader: async () => {
    await Promise.all([categoriesCollection.preload()])
  },
})
```

### 8. Use in your components

And use with [TanStack DB live queries](https://tanstack.com/db/latest/docs/guides/live-queries) and [optimistic mutations](https://tanstack.com/db/latest/docs/overview#making-optimistic-mutations) in your components for instant local reads and writes:

```tsx
function Component() {
  const { data: categories } = useLiveQuery((q) =>
    q
      .from({ categoriesCollection })
      .orderBy(/* ... */)
  )

  const addCategory = (name, color) =>
    categoriesCollection.insert({
      name,
      color,
      // ...
    })

  return <List items={categories} add={addCategory} />
}
```

That's it! Your new table is now fully integrated with end-to-end, reactive, real-time sync using Electric, tRPC and TanStack DB.

## Pre-requisites

This project uses [Docker](https://www.docker.com), [Node](https://nodejs.org/en) with [pnpm](https://pnpm.io). You can see compatible versions in the `.tool-versions` file.

### Docker

Make sure you have Docker running. Docker is used to run the Postgres and Electric services defined in `docker-compose.yaml`.

### HTTPS in development

Electric's shape delivery [benefits significantly from HTTP/2 multiplexing](https://electric-sql.com/docs/guides/troubleshooting#slow-shapes-mdash-why-are-my-shapes-slow-in-the-browser-in-local-development).

Without HTTP/2, each shape subscription creates a new HTTP/1.1 connection, which browsers limit to 6 concurrent connections per domain. This creates a bottleneck that makes shapes appear slow.

This starter uses the `@electric-sql/vite-plugin-trusted-https` plugin to:

- automatically generates and manages SSL certificates for development
- installs certificates to your local user trust store
- provides HTTPS with HTTP/2 support out of the box

#### Troubleshooting HTTPS

If you encounter SSL certificate problems:

1. try wiping the `.certs` folder with `rm -rf .certs`
2. try installing `mkcert`, e.g.: with `brew install mkcert` and `mkcert -install`
3. re-run `pnpm trust`
4. restart your browser

Alternatively, you can fallback on a self-signed certificate and click through the warnings in the browser.

## Troubleshooting

### Common pitfalls

| Issue                        | Symptoms                                   | Solution                                                           |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| **Docker not running**       | `docker compose ps` shows nothing          | Start Docker Desktop/daemon                                        |
| **Port conflicts**           | Postgres (54321) or Electric (3000) in use | Stop conflicting services or change ports in `docker-compose.yaml` |
| **Missing .env**             | Database connection errors                 | Copy `.env.example` to `.env`                                      |
| **Certificates not trusted** | SSL warnings in browser                    | Run `pnpm trust` and authorize the certificate install             |

### Debugging commands

For troubleshooting, these commands are helpful:

```sh
# Check Docker services status
docker compose ps

# View Electric and Postgres logs
docker compose logs -f electric postgres

# Test database connectivity
psql $DATABASE_URL -c "SELECT 1"

# Check HTTPS certificate status
pnpm trust:status
```

## Building For production

To build this application for production:

```bash
pnpm run build
```

### Production deployment checklist

Before deploying to production, ensure you have configured:

#### Required environment variables

```bash
# Authentication - REQUIRED in production
BETTER_AUTH_SECRET=your-secret-key-here

# Electric Cloud (if using hosted Electric)
ELECTRIC_SOURCE_ID=your-source-id
ELECTRIC_SOURCE_SECRET=your-source-secret

# Database (adjust for your production database)
DATABASE_URL=postgresql://user:pass@your-prod-db:5432/dbname
```

#### Authentication setup

**⚠️ Important**: The current setup allows any email/password combination to work in development. This is **automatically disabled** in production, but you need to:

1. **Configure proper auth providers** in `src/lib/auth.ts` (Google, GitHub, etc.)
2. **Remove or secure the dev-only email/password auth** if you plan to use it
3. **Review `trustedOrigins`** settings for your production domains

#### Infrastructure changes

- **HTTPS & Secure Cookies**: Ensure your deployment platform handles HTTPS termination
- **Database**: Use a managed PostgreSQL service (not the Docker container)
- **Environment**: Set `NODE_ENV=production`

#### Security considerations

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

### Adding a route

To add a new route to your application just add another a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding links

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

### Using a layout

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

## Data fetching

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

#### Core concepts

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

#### Live queries with cross-collection joins

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

#### tRPC integration for mutations

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

**API routes:**

- `/api/trpc/*` - tRPC mutations with full type safety
- `/api/auth/*` - Authentication via better-auth
- `/api/projects`, `/api/todos`, `/api/users` - Electric sync shapes for reads

### Core architecture rules

Follow these patterns to get the most out of this starter:

- **Use Electric for reads** - `useLiveQuery` with collections, not tRPC queries
- **Use collection operations for writes** - Call `collection.insert()`, not `trpc.create.mutate()` directly
- **Preload collections in route loaders** - Prevents loading flicker and ensures data availability

#### Why these rules matter

- **Electric handles reads** - Direct tRPC reads bypass real-time sync and optimistic updates
- **Collection operations are optimistic** - They update the UI immediately while syncing in the background
- **Preloading prevents flicker** - Collections load before components render, ensuring data is available

# Learn more

- [TanStack documentation](https://tanstack.com)
- [TanStack DB documentation](https://tanstack.com/db/latest/docs/overview)
- [An Interactive Guide to TanStack DB](https://frontendatscale.com/blog/tanstack-db)
- [Stop Re-Rendering — TanStack DB, the Embedded Client Database for TanStack Query](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query)
- [Local-first sync with TanStack DB and Electric](https://electric-sql.com/blog/2025/07/29/local-first-sync-with-tanstack-db)
