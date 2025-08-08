Welcome to your new TanStack [Start](https://tanstack.com/start/latest)/[DB](https://tanstack.com/db/latest) + [Electric](https://electric-sql.com/) app!

# Getting Started

## Create a new project

To create a new project based on this starter, run the following commands:

```
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-tanstack-db-project
cd my-tanstack-db-project
```

Copy the .env.example file to .env and fill in the values.

_The database url will be set by default to development postgres docker container, and during development the better-auth secret is not required._

```
cp .env.example .env
```

## Prerequisites

This project uses [Caddy](https://caddyserver.com/) for local HTTPS development:

1. **Install Caddy** for your OS — https://caddyserver.com/docs/install
2. **Run `caddy trust`** so Caddy can install its certificate into your OS. This is necessary for http/2 to Just Work™ without SSL warnings/errors in the browser — https://caddyserver.com/docs/command-line#caddy-trust

Docker is also required to run Postgres and the ElectricSQL sync engine.

## Running the Application

Install dependencies and run the application.

```
pnpm install
pnpm run dev
```

The `dev` command will start both the dev server and a docker compose with Postgres and the ElectricSQL sync engine.

In another terminal, run the migrations.

```
pnpm run migrate
```

Visit `https://tanstack-start-db-electric-starter.localhost/` to see the application.

# Building For Production

To build this application for production:

```bash
pnpm run build
```

## AI

The starter includes an `AGENT.md`. Depending on which AI coding tool you use, you may need to copy/move it to the right file name e.g. `.cursor/rules`.

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

This starter uses ElectricSQL for a fully local-first experience with real-time sync:

```tsx
import { createCollection } from "@tanstack/react-db"
import { electricCollectionOptions } from "@tanstack/electric-db-collection"

export const todoCollection = createCollection(
  electricCollectionOptions<Todo>({
    id: "todos",
    schema: todoSchema,
    // Electric syncs data using "shapes" - filtered views on database tables
    shapeOptions: {
      url: "https://api.electric-sql.cloud/v1/shape",
      params: {
        table: "todos",
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
import { useLiveQuery } from "@tanstack/react-db"

const Todos = () => {
  // Read data using live queries with cross-collection joins
  const { data: todos } = useLiveQuery((query) =>
    query
      .from({ t: todoCollection })
      .join({
        type: "inner",
        from: { l: listCollection },
        on: [`@l.id`, `=`, `@t.list_id`],
      })
      .where("@l.active", "=", true)
      .select("@t.id", "@t.text", "@t.status", "@l.name")
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

You can learn more about TanStack DB in the [TanStack DB documentation](https://tanstack.com/db/latest/docs/overview).

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).
