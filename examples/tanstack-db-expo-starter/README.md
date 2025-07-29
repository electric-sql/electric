# Expo, TanStack DB, and Electric Starter

https://github.com/user-attachments/assets/b4be50e9-3ab1-4684-8964-26defdfcfeb6

## Why these technologies?

### TanStack DB

TanStack DB is a reactive client store for building super-fast apps. It extends TanStack Query with collections, live queries, and optimistic mutations that keep your app reactive, consistent, and blazing fast. It provides a reactive data layer for your application, making it easy to manage and synchronize data between your UI and your database.

### ElectricSQL

ElectricSQL is a Postgres sync engine that solves the hard problems of data synchronization for you, including partial replication, fan-out, and data delivery. It provides a seamless way to sync your Postgres database with your local application, enabling a true local-first experience. This means your app is fast, works offline, and syncs automatically when a connection is available.

## Key Files

*   [`app/index.tsx`](./app/index.tsx) - The main entry point for the Expo application.
*   [`api/index.ts`](./api/index.ts) - The entry point for your serverless functions (if you choose to use them).
*   [`src/db/schema.ts`](./src/db/schema.ts) - The database schema definition for ElectricSQL.

## Create a new project

To create a new project based on this starter, run the following commands:

```
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-expo-starter my-tanstack-db-expo-project
cd my-tanstack-db-expo-project
```

## Setup

1.  Install dependencies:

    ```bash
    pnpm i
    ```

2.  Start the development server & API server in different terminals:

    ```bash
    pnpm start
    ```

    ```bash
    pnpm api
    ```

3.  Push database schema changes:

    ```bash
    pnpm db:push
    ```

## Notes

*   [`react-native-random-uuid`](https://github.com/LinusU/react-native-random-uuid) is needed as a polyfill for TanStack DB on React Native/Expo.

