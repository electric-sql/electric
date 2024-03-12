---
title: Expo
sidebar_position: 10
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

ElectricSQL supports [Expo](https://expo.dev) via both [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) and [expo-sqlite/next](https://docs.expo.dev/versions/latest/sdk/sqlite-next/).

## Dependencies

Add `expo-sqlite` as a dependency to your app, e.g.:

```shell
npx expo install expo-sqlite
```

This package includes both the regular and `next` drivers. See the [expo-sqlite docs](https://docs.expo.dev/versions/latest/sdk/sqlite/) or [expo-sqlite/next docs](https://docs.expo.dev/versions/latest/sdk/sqlite-next/) for more information.

## Polyfills

ElectricSQL uses the [Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Crypto), base64 and text encoding / decoding, all of which are not available in React Native. To make ElectricSQL work, you need to polyfill these missing functions. 

```shell
npx expo install expo-crypto fastestsmallesttextencoderdecoder base-64
```

Create file for initializing the polyfills:

```typescript
// polyfills.ts
import "fastestsmallesttextencoderdecoder";
import * as Crypto from "expo-crypto";
import { decode, encode } from "base-64";

declare const global: {
  crypto: {
    getRandomValues(array: Uint8Array): Uint8Array;
    randomUUID(): string;
  };
  btoa: (input: string) => string;
  atob: (input: string) => string;
};

if (!global.btoa) {
  global.btoa = encode;
}

if (!global.atob) {
  global.atob = decode;
}

if (!global.crypto) {
  global.crypto = {
    getRandomValues(array: Uint8Array) {
      return Crypto.getRandomValues(array);
    },
    randomUUID() {
      return Crypto.randomUUID();
    },
  };
}

// @ts-expect-error
if (!global.window) {
  // @ts-expect-error
  global.window = {
    addEventListener: () => {},
  };
}
```

And load it before all other imports, either in your root `App.(js/ts)` or in your `_layout.(ts/js)`, if you are using expo-router.

```typescript
// _layout.ts
// !THIS NEEDS TO BE THE FIRST IMPORT!
import "./polyfills";

// all other imports, e.g. import * from ...
import { Stack } from "expo-router";

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen />
    </Stack>
  )
}

```

## Usage

<Tabs groupId="usage" queryString>
<TabItem value="expo-sqlite" label="expo-sqlite">

```ts
import * as SQLite from 'expo-sqlite'
import { electrify } from 'electric-sql/expo'

// Create the expo-sqlite database connection. The first argument
// is your database name. Changing this will create/use a new
// local database file.
const conn = SQLite.openDatabase('electric.db')
```

</TabItem>

<TabItem value="expo-sqlite-next" label="expo-sqlite/next">

```ts
import * as SQLite from 'expo-sqlite/next'
import { electrify } from 'electric-sql/expo-next' 

// Create the expo-sqlite database connection. The first argument
// is your database name. Changing this will create/use a new
// local database file.
const conn = SQLite.openDatabaseSync('electric.db')
```

</TabItem>
</Tabs>

You can now instantiate an Electric client for the database connection and use it to read, write and sync data, e.g.:

```ts
// Import your generated database schema.
import { schema } from './generated/client'

// Define custom configuration if needed
const config = { url: 'https://example.com:5133' }

// Instantiate your electric client.
const electric = await electrify(conn, schema, config)

// Connect to Electric, passing along your authentication token
// See Usage -> Authentication for more details.
await electric.connect('your token')

const { db } = electric

const results = await db.projects.findMany()
console.log(results)
```

See <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
