---
title: Vue.js
description: >-
  The progressive JavaScript framework.
sidebar_position: 50
---

ElectricSQL integrates with Vue via a [dependency injection](#dependency-injection) and the [Reactivity API](#hooks).

The dependency injection provides your Electric [Client](../../usage/data-access/client.md) to your components. The reactivity API is used to bind [live queries](../../usage/data-access/queries.md#live-queries) to your components.

## Dependency Injection

### `makeElectricDependencyInjector`

In Vue.js, [dependency injection](https://vuejs.org/api/composition-api-dependency-injection.html) provides a way to pass data through the component tree without having to pass props down manually at every level. ElectricSQL provides a `makeElectricDependencyInjector` function that constructs a `provideElectric` [provider method](https://vuejs.org/api/composition-api-dependency-injection.html#provide) and an `injectElectric` [injector method](https://vuejs.org/api/composition-api-dependency-injection.html#inject).

```ts
import { makeElectricDependencyInjector } from 'electric-sql/vuejs'
import { Electric } from './generated/client'

const {
  provideElectric,
  injectElectric
} = makeElectricDependencyInjector<Electric>()
```

You typically call this once per app as part of your instantiation code. You then use the `provide` and `inject` methods in tandem to pass down and access the client in your components.

:::info
We provide this dynamic API rather than static `provideElectric` and `injectElectric` imports in order to preserve the type information about your database structure. As you can see from the example above, the context is constructed using the `Electric` type argument, which is a generated type containing all of the information about your database structure. This then allows you to write type safe data access code.
:::

### `provideElectric` and `injectElectric`

`provideElectric` is a [provider](https://vuejs.org/api/composition-api-dependency-injection.html#provide) method that injects the Electric [Client](../../usage/data-access/client.md) instance to the rest of the app under an Electric-specific symbol key, so it will never clash with other dependency injections. You can call it within the context of a provider-like component, e.g.:

```vue
// ElectricProvider.vue
<script lang="ts">
import { computed, defineComponent, onMounted, shallowRef } from 'vue'
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'
import { insecureAuthToken } from 'electric-sql/auth'
import { provideElectric } from './electric'
import { Electric, schema } from './generated/client'
export default defineComponent({
  setup() {
    // use shallow reference for the client as deep reactivity is not
    // necessary and likely to cause issues
    const electricRef = shallowRef<Electric>()
    const showChild = computed(() => electricRef.value !== undefined)

    onMounted(async () => {
      const config = { auth: { token: insecureAuthToken() } }
      const conn = await ElectricDatabase.init('electric.db')
      const electric = await electrify(conn, schema, config)

      // update the reference with client instance
      electricRef.value = electric
    })

    // provide the client to the rest of the app
    provideElectric(electricRef)

    return { showChild }
  },
})
</script>

<template>
  <div v-if="showChild">
    <slot />
  </div>
</template>
```

With a `provideElectric` call in a parent component in place, you can then access the `electric` client instance using the `injectElectric` method, e.g.:

```vue
<script lang="ts">
import { defineComponent, ref } from 'vue'
import { injectElectric } from './electric'

export default defineComponent({
  setup() {
    const { db } = injectElectric()!
    const value = ref()

    const generate = async () => {
      const { newValue } = await db.rawQuery({
        sql: 'select random() as newValue'
      })

      value.value = newValue
    }
      
    return { value }
  },
});
</script>

<template>
  <div>
    <p>{{ value }}</p>
    <a @click="generate"> Generate ↺ </a>
  </div>
</template>
```

## Reactive API

### `useLiveQuery`

`useLiveQuery` sets up a live query (aka a dynamic or reactive query). This takes query function returned by one of the `db.live*` methods and keeps the results in sync whenever the relevant data changes.

```vue
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useLiveQuery } from 'electric-sql/vuejs'
import { injectElectric } from './electric'

export default defineComponent({
  setup() {
    const { db } = useElectric()!

    // Use the query builder API.
    const { results } = useLiveQuery(
      db.items.liveMany()
    )

    // Use the raw SQL API.
    const { results: countResults } = useLiveQuery(
      db.liveRawQuery({
        sql: 'select count(*) from items'
      })
    )

    const items: Item[] = computed(() => results ?? [])
    
    const count: number = computed(
      () => countResults.value !== undefined 
        ? countResults.value[0].count 
        : items.value.length
    )
    return { items, count }
  },
});
</script>

<template>
  <div>
    <p>
      {{ count }}
      {{ count === 1 ? 'item' : 'items' }}
    </p>
    <ul>
      {{items.map((item, index) => (
        <li key={ index }>
          Item: { item.value }
        </li>
      ))}}
    </ul>
  </div>
</template>
```

The full return value of the live query method is:

```tsx
const { results, error, updatedAt } = useLiveQuery(runQuery)
```

Where all destructured values are [read-only](https://vuejs.org/api/reactivity-core.html#readonly) [reactive ref objects](https://vuejs.org/api/reactivity-core.html#ref) which can be used with all of Vue reactivity APIs such as [`computed`](https://vuejs.org/api/reactivity-core.html#computed) and [`watchEffect`](https://vuejs.org/api/reactivity-core.html#watcheffect).

Running the query successfully will assign a new array of rows to the `results` and the `error` will be `undefined`. Or if the query errors, the error will be assigned to the `error` and `results` will be `undefined`. The `updatedAt` ref object is a [Date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date) instance set when the return value last changed. Which is either when the query is first run or whenever it's re-run following a data change event.

See the implementation in [frameworks/vuejs/reactive/useLiveQuery.ts](https://github.com/electric-sql/electric/blob/main/clients/typescript/src/frameworks/vuejs/reactive/useLiveQuery.ts) for more details.

#### Query dependencies

The live query is always re-run when any of the data in any of the tables it depends on changes. When using the static form of `useLiveQuery` that takes a live query as an argument, the results will not be reactive with respect to the query parameters.

To make the results reactive with respect to the query parameters, you can use the dynamic form of `useLiveQuery` that takes a function that returns a live query, or a reference to a live query. Under the hood, the live query will be recomputed when any of the query parameters change by observing the resulting query string. This means that the query function will be re-run when any of the parameters change, e.g.:

```ts
export default defineComponent({
  setup() {
    const status = ref(true)

    const { results } = useLiveQuery(
      () => db.projects.liveMany({
        where: { status: status }
      })
    )

    // `results` will be recomputed on data changes
    // and anytime the `status` flag changes

    // ...
  }
})
```

With this API, any change to the query dependencies will cause it to recompute. You can exert more control over this recomputation by passing an explicit list of [Watch Sources](https://vuejs.org/guide/essentials/watchers.html#watch-source-types) as a second argument to `useLiveQuery`, such that the query is recomputed when any of the provided watch sources changes:

```ts
export default defineComponent({
  setup() {
    const status = ref(true)
    const filter = ref('@example.com')

    const { results } = useLiveQuery(
      () => db.projects.liveMany({
        where: {
          status: status,
          email: { endsWith: filter }
        }
      }),
      [ status ]
    )

    // `results` will be recomputed on data changes
    // and anytime the `status` flag changes, but not
    // when the `filter` changes

    // ...
  }
})
```
