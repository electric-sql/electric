---
title: Vue
description: >-
  Integration guide for using ElectricSQL with Vue 3 applications.
deployed_url: https://basic.examples.electric-sql.com
source_url: https://github.com/electric-sql/electric/tree/main/examples/vue
image: /img/integrations/vue.svg
example: true
---

<img src="/img/integrations/vue.svg" class="product-icon" />

# Vue

Vue is a progressive JavaScript framework for building user interfaces with a focus on declarative rendering and component composition.

## Electric and Vue

Electric provides first-class support for Vue 3 through our [`vue-composables`](https://github.com/electric-sql/electric/tree/main/packages/vue-composables) package. This integration leverages Vue's Composition API to deliver efficient, reactive data binding with ElectricSQL Shapes.

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

#### Reactive Shape

The [`useShape`](https://github.com/electric-sql/electric/blob/main/packages/vue-composables/src/use-shape.ts) returns a reactive [Shape](/docs/api/clients/typescript#shape):

```ts
interface UseShapeResult<T> {
  data: Ref<T[]> // Reactive array of rows
  shape: Shape<T> // Underlying Shape instance
  stream: ShapeStream<T> // Underlying ShapeStream instance
  isLoading: Ref<boolean> // Loading state indicator
  lastSyncedAt: Ref<number | undefined> // Timestamp of last sync
  error: Ref<Shape<T>["error"]> // Error state
  isError: Ref<boolean> // Error indicator
}
```

All data-related properties are Vue reactive references, enabling automatic component updates when data changes.

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

`useShape` accepts the same options as [ShapeStream](/docs/api/clients/typescript#options) with additional Vue-specific parameters.

#### Query Parameters

Configure your shape subscription with these parameters:

- `table` - PostgreSQL table name to subscribe to
- `where` - Optional SQL WHERE clause for filtering data
- `columns` - Optional array of column names to select

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

> **Note**: Join queries are not currently supported. For data relationships, see the [Table Joins](#shape-joins) section.

### Utility Functions

#### `preloadShape`

Preload shape data before component rendering:

```ts
import { preloadShape } from "@electric-sql/vue"

// Inside a router guard or async setup
const itemsData = await preloadShape({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: "items",
  },
})
```

This function is useful for ensuring data is available before mounting components.

#### `getShapeStream` and `getShape`

Low-level utilities for direct stream and shape management:

```ts
import { getShapeStream, getShape } from "@electric-sql/vue"

// Get or create a stream from cache
const stream = getShapeStream<Item>({
  url: `http://localhost:3000/v1/shape`,
  params: { table: "items" },
})

// Get or create a shape from cache
const shape = getShape<Item>(stream)
```

These functions help prevent duplicate streams and shapes when accessing the same data in multiple components.

### Advanced Configuration

#### Custom Fetch Client

Implement a custom fetch client for specialized networking needs:

```ts
const items = useShape<Item>({
  url: `http://localhost:3000/v1/shape`,
  params: { table: "items" },
  fetchClient: async (input, init) => {
    // Add authentication headers
    return fetch(input, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${yourAuthToken}`,
      },
    })
  },
})
```

#### Subscription Control

Manage subscription lifecycle with `AbortController`:

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

// Clean up when component unmounts
onUnmounted(() => controller.abort())
</script>
```

## Shape Joins

Since ElectricSQL doesn't directly support join queries, implement data relationships using computed properties and multiple shape subscriptions.
You can read more on shapes [here](/docs/guides/shapes).

### Join Implementation Pattern

```vue
<script setup lang="ts">
import { useShape } from "@electric-sql/vue"
import { computed } from "vue"

// Define clear data types
type User = {
  id: string
  name: string
  email: string
}

type Post = {
  id: string
  user_id: string
  title: string
  content: string
  created_at: string
}

// Subscribe to both tables
const users = useShape<User>({
  url: "http://localhost:3000/v1/shape",
  params: { table: "users" },
})

const posts = useShape<Post>({
  url: "http://localhost:3000/v1/shape",
  params: { table: "posts" },
})

// Create efficient computed join
const usersWithPosts = computed(() => {
  // Only run join when data is available
  if (users.isLoading.value || posts.isLoading.value) return []

  // Map users to include their posts
  return users.data.value.map((user) => ({
    ...user,
    posts: posts.data.value.filter((post) => post.user_id === user.id),
  }))
})

// Simple loading state
const isLoading = computed(() => users.isLoading.value || posts.isLoading.value)
</script>

<template>
  <div>
    <h1>Users and Their Posts</h1>

    <!-- Unified loading state -->
    <div v-if="isLoading" class="loading">Loading data...</div>

    <!-- Render joined data -->
    <div v-else class="users-list">
      <div v-for="user in usersWithPosts" :key="user.id" class="user-card">
        <h2>{{ user.name }}</h2>
        <p class="email">{{ user.email }}</p>

        <div class="posts">
          <h3>Posts ({{ user.posts.length }})</h3>

          <div v-if="user.posts.length === 0" class="no-posts">
            No posts yet
          </div>

          <div v-for="post in user.posts" :key="post.id" class="post-card">
            <h4>{{ post.title }}</h4>
            <p>{{ post.content }}</p>
            <div class="post-date">
              Posted: {{ new Date(post.created_at).toLocaleDateString() }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
```

### Key Benefits of Computed Joins

1. **Improved Performance**: Joins happen in memory only when needed
2. **Reactive Updates**: Data automatically refreshes when either table changes
3. **Minimized Template Logic**: Complex data handling stays in the script section
4. **Optimized Rendering**: Vue only re-renders affected components

## Performance Considerations

- Use `columns` parameter to fetch only required fields
- Apply specific `where` clauses to limit data volume
- Consider using `AbortController` to terminate unused subscriptions
- Move complex data transformations to computed properties

You can read more on Shape Performance [here](/docs/guides/shapes).

