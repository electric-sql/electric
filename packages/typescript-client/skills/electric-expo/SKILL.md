---
name: electric-expo
description: >
  React Native + Expo setup — react-native-random-uuid polyfill,
  electricCollectionOptions, useLiveQuery, mobile proxy patterns, Express
  backend, hostname detection via expo-constants, txid generation,
  timestamp parsing, collection CRUD handlers
type: composition
library: '@electric-sql/client'
library_version: '1.5.8'
requires:
  - 'expo'
  - '@tanstack/react-db'
  - '@tanstack/electric-db-collection'
  - 'react-native-random-uuid'
sources:
  - 'electric:examples/tanstack-db-expo-starter'
  - 'electric:AGENTS.md'
---

# Expo/React Native + Electric

React Native integration with Electric sync via TanStack DB collections.

## Setup

```bash
npx create-expo-app my-app
cd my-app
pnpm add @electric-sql/client @tanstack/react-db @tanstack/electric-db-collection
pnpm add react-native-random-uuid expo-constants
```

**Critical**: Import the UUID polyfill at the top of your entry point:

```typescript
// index.ts or app/_layout.tsx — MUST be first import
import 'react-native-random-uuid'
```

## Core Patterns

### Collection Setup

```typescript
import 'react-native-random-uuid'
import { createCollection, useLiveQuery } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { selectTodoSchema } from './db/schema'
import { hostname } from './utils/api-client'

const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: selectTodoSchema,
    getKey: (item) => item.id,
    shapeOptions: {
      url: `http://${hostname}:3001/api/todos`,
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },
    onInsert: async ({ transaction }) => {
      const { txid } = await apiClient.createTodo(
        transaction.mutations[0].modified
      )
      return { txid: String(txid) }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const { txid } = await apiClient.updateTodo(original.id, changes)
      return { txid: String(txid) }
    },
    onDelete: async ({ transaction }) => {
      const { id } = transaction.mutations[0].original
      const { txid } = await apiClient.deleteTodo(id)
      return { txid: String(txid) }
    },
  })
)
```

### Hostname Detection

```typescript
// src/utils/api-client.ts
import Constants from 'expo-constants'

export const hostname =
  Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost'
```

In development, Expo dev server and your backend run on the same host but
different ports. `expo-constants` extracts the correct hostname.

### Express Backend with Proxy

```typescript
import express from 'express'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const app = express()

// Shape proxy
app.get('/api/todos', async (req, res) => {
  const electricUrl = new URL(
    `${process.env.ELECTRIC_URL || 'http://localhost:3000'}/v1/shape`
  )

  Object.keys(req.query).forEach((key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key as any)) {
      electricUrl.searchParams.set(key, req.query[key] as string)
    }
  })
  electricUrl.searchParams.set('table', 'todos')

  const response = await fetch(electricUrl)
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    if (key !== 'content-encoding' && key !== 'content-length') {
      headers[key] = value
    }
  })

  res.writeHead(response.status, headers)
  const { Readable } = require('stream')
  const nodeStream = Readable.fromWeb(response.body)
  nodeStream.pipe(res)
})

// CRUD endpoints (return txid)
app.post('/api/todos', async (req, res) => {
  const result = await db.transaction(async (tx) => {
    const txid = await generateTxId(tx)
    const [todo] = await tx.insert(todos).values(req.body).returning()
    return { todo, txid }
  })
  res.json(result)
})
```

### React Native UI

```tsx
export default function HomeScreen() {
  const [text, setText] = useState('')
  const { data: todos } = useLiveQuery((q) => q.from({ todoCollection }))

  return (
    <View>
      <TextInput value={text} onChangeText={setText} />
      <Button
        title="Add"
        onPress={() => {
          if (text.length > 0) {
            todoCollection.insert({
              id: Math.floor(Math.random() * 1000000),
              text,
              completed: false,
              created_at: new Date(),
              updated_at: new Date(),
            })
            setText('')
          }
        }}
      />
      <FlatList
        data={todos}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() =>
              todoCollection.update(item.id, (d) => {
                d.completed = !d.completed
              })
            }
          >
            <Text>{item.text}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}
```

## Common Mistakes

### [HIGH] Missing react-native-random-uuid polyfill

Wrong:

```typescript
// Entry point — no UUID polyfill
import { createCollection } from '@tanstack/react-db'
// crypto.randomUUID() throws: "crypto.randomUUID is not a function"
```

Correct:

```typescript
// Entry point — polyfill MUST be first import
import 'react-native-random-uuid'
import { createCollection } from '@tanstack/react-db'
```

React Native lacks `crypto.randomUUID()`. The polyfill must be imported before
any code that uses it (including TanStack DB internals).

Source: AGENTS.md React Native note

### [HIGH] Using localhost URL in Expo app

Wrong:

```typescript
shapeOptions: {
  url: "http://localhost:3001/api/todos",
}
```

Correct:

```typescript
import Constants from "expo-constants"
const hostname = Constants.expoConfig?.hostUri?.split(":")[0] ?? "localhost"

shapeOptions: {
  url: `http://${hostname}:3001/api/todos`,
}
```

On physical devices, `localhost` refers to the device itself, not your dev machine.
Use `expo-constants` to get the correct host.

Source: examples/tanstack-db-expo-starter

### [CRITICAL] Not returning txid from mobile API

Wrong:

```typescript
app.post('/api/todos', async (req, res) => {
  const [todo] = await db.insert(todos).values(req.body).returning()
  res.json({ todo })
})
```

Correct:

```typescript
app.post('/api/todos', async (req, res) => {
  const result = await db.transaction(async (tx) => {
    const txid = await generateTxId(tx)
    const [todo] = await tx.insert(todos).values(req.body).returning()
    return { todo, txid }
  })
  res.json(result)
})
```

Without txid, optimistic state never drops and UI shows duplicates.

Source: AGENTS.md Write-path contract

## References

- [Expo Documentation](https://docs.expo.dev)
- [tanstack-db-expo-starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-expo-starter)
- [TanStack DB](https://tanstack.com/db/latest/docs/overview)
