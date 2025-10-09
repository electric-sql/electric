---
outline: deep
title: Expo - Integrations
description: >-
  How to use Electric to sync data into Expo apps.
image: /img/integrations/electric-expo.jpg
---

<img src="/img/integrations/expo.svg" class="product-icon" />

# Expo

Expo is a platform that helps you deploy React Native applications.

## Electric and Expo

Expo applications are developed in Javacript (or Typescript) using [React Native](https://reactnative.dev).

You can use the Electric [Typescript client](/docs/api/clients/typescript) in your Expo applications. This allows you to sync data from Electric into mobile apps.

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

## Example

Follow the [Expo Quickstart](https://docs.expo.dev/get-started/create-a-project/) to create an Expo app. Replace the generated `./app/(tabs)/index.tsx` with the following:

```tsx
import { Text } from 'react-native'
import { useShape } from '@electric-sql/react'

// Edit to match your setup.
const ELECTRIC_URL = 'https://my-electric-sync-service.example.com'

export default function HomeScreen() {
  const { isLoading, data } = useShape({
    url: `${ELECTRIC_URL}/v1/shape`,
    params: {
      table: 'items',
    },
  })

  if (isLoading) {
    return null
  }

  return <Text>{JSON.stringify(data, null, 4)}</Text>
}
```

Install `@electric-sql/react` (if necessary using `--force` to work around a React dependency version mismatch):

```shell
npm install '@electric-sql/react' --force
```

Run, e.g. in the browser:

```shell
npm run web
```

If there's data in the `items` table of your Postgres, you should see it syncing into your app.

## PGlite

[PGlite](https://pglite.dev) doesn't _yet_ work in React Native.

We have an [open issue tracking support for it](https://github.com/electric-sql/pglite/issues/87). When it does, we hope to work with the Expo team to get an official `expo-pglite` package published.
