---
outline: deep
title: Vue - Integrations
description: >-
  How to use Electric with Vue.
image: /img/integrations/vue.svg
---

<img src="/img/integrations/vue.svg" class="product-icon" />

# Vue

Vue is a progressive JavaScript framework for building user interfaces with a focus on declarative rendering and component composition.

## Electric and Vue

Electric provides first-class support for Vue 3 through our [`vue-composables`](https://github.com/electric-sql/electric/tree/main/packages/vue-composables) package. It exposes a `useShape` composable that binds Shape data to your components using Vue's Composition API.

## Installation

The package is published on NPM as [`@electric-sql/vue`](https://www.npmjs.com/package/@electric-sql/vue):

```shell
# npm
npm install @electric-sql/vue

# pnpm
pnpm add @electric-sql/vue

# yarn
yarn add @electric-sql/vue
```

## Subscribing to Shapes

### `useShape`

[`useShape`](https://github.com/electric-sql/electric/blob/main/packages/vue-composables/src/use-shape.ts) returns a `reactive()` object bound to an Electric [Shape](/docs/api/clients/typescript#shape). Properties update automatically without `.value` unwrapping.

```ts
interface UseShapeResult<T> {
  data: T[]                    // Array of rows
  shape: Shape<T>              // Underlying Shape instance
  stream: ShapeStream<T>       // Underlying ShapeStream instance
  isLoading: boolean           // True during initial fetch
  lastSyncedAt: number | undefined // Timestamp of last sync
  error: Shape<T>["error"]    // Error state
  isError: boolean             // Error indicator
}
```

### Best practice: use API endpoints

:::tip Recommended
Proxy Electric requests through your backend API in production. This gives you security, authorization, and a clean API surface.
:::

```vue
<script setup lang="ts">
import { useShape } from "@electric-sql/vue"

type Item = { title: string }

const items = useShape<Item>({
  url: `http://localhost:3001/api/items`, // Your API endpoint
})
</script>

<template>
  <div>
    <div v-if="items.isLoading">Loading ...</div>
    <template v-else>
      <div v-for="item in items.data" :key="item.title">{{ item.title }}</div>
    </template>
  </div>
</template>
```

**See the [authentication guide](/docs/guides/auth) for a complete proxy implementation with streaming, error handling, and authorization.**

### Direct connection (development only)

For local development, you can connect directly to Electric:

```vue
<script setup lang="ts">
import { useShape } from "@electric-sql/vue"

type Item = { title: string }

const items = useShape<Item>({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: "items",
  },
})
</script>

<template>
  <div>
    <div v-if="items.isLoading">Loading ...</div>
    <template v-else>
      <div v-for="item in items.data" :key="item.title">{{ item.title }}</div>
    </template>
  </div>
</template>
```

`useShape` accepts the same options as [ShapeStream](/docs/api/clients/typescript#options).

### Query parameters

You can filter and select columns with PostgreSQL-specific parameters:

```ts
const items = useShape<{ id: number; title: string }>({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: "items",
    where: "status = 'active'",
    columns: ["id", "title"],
  },
})
```

> **Note**: Join queries are not directly supported. See [Shape joins](#shape-joins) below for a workaround using `computed`.

### Utility functions

#### `preloadShape`

Preload shape data before rendering — useful in router guards or async setup:

```ts
import { preloadShape } from "@electric-sql/vue"

const itemsData = await preloadShape({
  url: `http://localhost:3001/api/items`,
})
```

#### `getShapeStream` and `getShape`

Get-or-create cached stream and shape instances:

```ts
import { getShapeStream, getShape } from "@electric-sql/vue"

const stream = getShapeStream<Item>({
  url: `http://localhost:3001/api/items`,
})

const shape = getShape<Item>(stream)
```

These prevent duplicate streams when multiple components subscribe to the same data.

### Subscription control

You can abort a shape's subscription with an `AbortController`:

```vue
<script setup lang="ts">
import { useShape } from "@electric-sql/vue"
import { onUnmounted } from "vue"

const controller = new AbortController()

const items = useShape({
  url: `http://localhost:3000/v1/shape`,
  params: { table: "items" },
  signal: controller.signal,
})

onUnmounted(() => controller.abort())
</script>
```

Note that if multiple components share the same shape, aborting will stop updates for all of them. We plan to add a better API for per-component unsubscription — if you're interested, please [file an issue](https://github.com/electric-sql/electric/issues).

## Shape joins

Since Electric doesn't support join queries, you can combine multiple shapes with `computed`:

```vue
<script setup lang="ts">
import { useShape } from "@electric-sql/vue"
import { computed } from "vue"

type User = { id: string; name: string; email: string }
type Post = { id: string; user_id: string; title: string; content: string; created_at: string }

const users = useShape<User>({
  url: "http://localhost:3001/api/users",
})

const posts = useShape<Post>({
  url: "http://localhost:3001/api/posts",
})

const isLoading = computed(() => users.isLoading || posts.isLoading)

const usersWithPosts = computed(() => {
  if (isLoading.value) return []

  return users.data.map((user) => ({
    ...user,
    posts: posts.data.filter((post) => post.user_id === user.id),
  }))
})
</script>

<template>
  <div>
    <h1>Users and their posts</h1>

    <div v-if="isLoading">Loading...</div>

    <div v-else>
      <div v-for="user in usersWithPosts" :key="user.id">
        <h2>{{ user.name }}</h2>
        <p>{{ user.email }}</p>

        <div v-if="user.posts.length === 0">No posts yet</div>

        <div v-for="post in user.posts" :key="post.id">
          <h4>{{ post.title }}</h4>
          <p>{{ post.content }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
```

The join runs in `computed`, so it recalculates automatically when either shape updates. You can read more about shapes [here](/docs/guides/shapes).

## Performance

- Use `columns` to fetch only the fields you need
- Use `where` to limit data volume
- Use `AbortController` to terminate subscriptions you no longer need
- Move transformations into `computed` — Vue will skip recalculation when inputs haven't changed

More on shape performance [here](/docs/guides/shapes).
