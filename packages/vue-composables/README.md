# @electric-sql/vue

Vue 3 composables for [ElectricSQL](https://electric-sql.com) — real-time Postgres sync.

## Install

```sh
npm i @electric-sql/vue
```

## Usage

`useShape` subscribes to an Electric [Shape](https://electric-sql.com/docs/api/clients/typescript#shape) and returns a `reactive()` object that updates automatically.

```vue
<script setup lang="ts">
import { useShape } from '@electric-sql/vue'

const { isLoading, data } = useShape<{ id: string; title: string }>({
  url: `http://localhost:3001/api/items`,
})
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else>
    <div v-for="item in data" :key="item.id">{{ item.title }}</div>
  </div>
</template>
```

Because the result is `reactive()`, there's no `.value` unwrapping — use `computed()` to derive or filter data:

```ts
import { computed } from 'vue'

const shape = useShape<Item>({ url: `/api/items` })
const active = computed(() => shape.data.filter((i) => i.active))
```

## API

### `useShape<T>(options): UseShapeResult<T>`

Takes the same options as [ShapeStream](https://electric-sql.com/docs/api/clients/typescript#options). Returns:

| Property       | Type                  | Description                     |
| -------------- | --------------------- | ------------------------------- |
| `data`         | `T[]`                 | Rows in the shape               |
| `isLoading`    | `boolean`             | `true` during initial fetch     |
| `lastSyncedAt` | `number \| undefined` | Unix timestamp of last sync     |
| `error`        | `Shape['error']`      | Error state, `false` if none    |
| `isError`      | `boolean`             | Whether an error occurred       |
| `shape`        | `Shape<T>`            | Underlying Shape instance       |
| `stream`       | `ShapeStream<T>`      | Underlying ShapeStream instance |

### `preloadShape<T>(options): Promise<Shape<T>>`

Eagerly fetches a shape before rendering. Useful in router guards or async setup.

### `getShapeStream<T>(options): ShapeStream<T>`

Returns a cached `ShapeStream`, creating one if it doesn't exist.

### `getShape<T>(stream): Shape<T>`

Returns a cached `Shape` for a given stream, creating one if it doesn't exist.

`Shape` and `ShapeStream` instances are cached globally, so reusing the same shape across components is cheap.

## License

Apache-2.0
