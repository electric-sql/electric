---
outline: deep
title: React - Integrations
description: >-
  How to use Electric with React.
image: /img/integrations/electric-react.jpg
---

<img src="/img/integrations/react.svg" class="product-icon" />

# React

React is a popular library for building declarative, component-based UI.

## Electric and React

Electric has first-class support for React. We maintain a [react-hooks](https://github.com/electric-sql/electric/tree/main/packages/react-hooks) package that provides a number of [React Hooks](https://react.dev/reference/react/hooks) to bind Shape data to your components.

## How to use

### Install

The package is published on NPM as [`@electric-sql/react`](https://www.npmjs.com/package/@electric-sql/react). Install using e.g.:

```shell
npm i @electric-sql/react
```

### Best Practice: Use API Endpoints

:::tip Recommended Pattern
Always proxy Electric requests through your backend API for production applications. This provides security, authorization, and a clean API interface.
:::

```tsx
// ✅ Recommended: Clean API pattern
import { useShape } from "@electric-sql/react"

const MyComponent = () => {
  const { isLoading, data } = useShape<{ title: string }>({
    url: `http://localhost:3001/api/items`, // Your API endpoint
  })

  if (isLoading) {
    return <div>Loading ...</div>
  }

  return (
    <div>
      {data.map((item) => (
        <div>{item.title}</div>
      ))}
    </div>
  )
}
```

**→ See the [authentication guide](/docs/guides/auth) for complete proxy implementation with streaming, error handling, and authorization.**

### `useShape`

[`useShape`](https://github.com/electric-sql/electric/blob/main/packages/react-hooks/src/react-hooks.tsx#L131) binds a materialised [Shape](/docs/api/clients/typescript#shape) to a state variable.

#### Direct Connection (Development Only)

For development, you can connect directly to Electric:

```tsx
// ⚠️ Development only - exposes database structure
import { useShape } from "@electric-sql/react"

const MyComponent = () => {
  const { isLoading, data } = useShape<{ title: string }>({
    url: `http://localhost:3000/v1/shape`,
    params: {
      table: "items",
    },
  })

  if (isLoading) {
    return <div>Loading ...</div>
  }

  return (
    <div>
      {data.map((item) => (
        <div>{item.title}</div>
      ))}
    </div>
  )
}
```

You can also include additional PostgreSQL-specific parameters:

```tsx
const MyFilteredComponent = () => {
  const { isLoading, data } = useShape<{ id: number; title: string }>({
    url: `http://localhost:3000/v1/shape`,
    params: {
      table: "items",
      where: "status = 'active'",
      columns: ["id", "title"],
    },
  })
  // ...
}
```

`useShape` takes the same options as [ShapeStream](/docs/api/clients/typescript#options). The return value is a `UseShapeResult`:

```tsx
export interface UseShapeResult<T extends Row<unknown> = Row> {
  /**
   * The array of rows that make up the materialised Shape.
   * @type {T[]}
   */
  data: T[]

  /**
   * The Shape instance used by this useShape
   * @type {Shape<T>}
   */
  shape: Shape<T>

  /** True during initial fetch. False afterwise. */
  isLoading: boolean

  /** Unix time at which we last synced. Undefined when `isLoading` is true. */
  lastSyncedAt?: number

  /** Unix time at which we last synced. Undefined when `isLoading` is true. */
  isError: boolean
  error: Shape<T>[`error`]
}
```

### `preloadShape`

[`preloadShape`](https://github.com/electric-sql/electric/blob/main/packages/react-hooks/src/react-hooks.tsx#L17) is useful to call in route loading functions or elsewhere when you want to ensure Shape data is loaded before rendering a route or component.

```tsx
// ✅ Production pattern with API proxy
export const clientLoader = async () => {
  return await preloadShape({
    url: `http://localhost:3001/api/items`,
  })
}
```

For development, you can connect directly:

```tsx
// ⚠️ Development only
export const devLoader = async () => {
  return await preloadShape({
    url: `http://localhost:3000/v1/shape`,
    params: {
      table: "items",
    },
  })
}
```

It takes the same options as [ShapeStream](/docs/api/clients/typescript#options).

### `getShapeStream`

[`getShapeStream<T>`](https://github.com/electric-sql/electric/blob/main/packages/react-hooks/src/react-hooks.tsx#L30) get-or-creates a `ShapeStream` off the global cache.

```tsx
// ✅ Production pattern
const itemsStream = getShapeStream<Item>({
  url: `http://localhost:3001/api/items`,
})
```

This allows you to avoid consuming multiple streams for the same shape log.

### `getShape`

[`getShape<T>`](https://github.com/electric-sql/electric/blob/main/packages/react-hooks/src/react-hooks.tsx#L49) get-or-creates a `Shape` off the global cache.

```tsx
// ✅ Production pattern
const itemsShape = getShape<Item>({
  url: `http://localhost:3001/api/items`,
})
```

This allows you to avoid materialising multiple shapes for the same stream.

### How to abort a shape subscription — `AbortController`

If you'd like to abort the shape's subscription to live updates e.g. after unmounting a component or navigating away from a route, you can use the [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController).

The following is a simple example which aborts the subscription when the component is unmounted.

```tsx
function MyComponent() {
  const [controller, _] = useState(new AbortController())

  const { data } = useShape({
    ...
    signal: controller.signal
  })

  useEffect(() => {
    return () => {
      // Live updates are now disabled.
      controller.abort()
    }
  }, [])

  ...
}
```

Note that if you have multiple components using the same component, this will stop updates for all subscribers. Which is probably not what you want. We plan to add a better API for unsubscribing from updates & cleaning up shapes that are no longer needed. If interested, please file an issue to start a discussion.
