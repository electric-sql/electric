---
title: Typescript
description: >-
  Function API and types provided by the generated data access library.
sidebar_position: 10
---

# Typescript client

The Typescript client provides a number of functions for developing front-end applications with Electric: 

- [Authenticating](../../usage/auth/) with the sync service
- [Synchronising database](#shapes) to a local SQLite database
- [Type-safe data access](#queries) to read and update the database
- [Reactive live queries](#live-queries) that update in realtime as the database changes

## Instantiation

A Typescript client comprises of:

1. SQLite database connection from a [supported driver](../../integrations/drivers/)
2. A client schema [generated using the generator command](../cli.md#generate)
3. A [configuration object](#configuration)

To instantiate the client, these are passed to an `electrify` function that is specific to your SQLite database driver and platform.

```ts
import { schema } from './generated/client'
import { insecureAuthToken } from 'electric-sql/auth'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'

const config = {
  auth: {
    clientId: 'dummy client id'
  }
}
const conn = await ElectricDatabase.init('electric.db', '')
const electric = await electrify(conn, schema, config)
const token = await insecureAuthToken({user_id: 'dummy'})
await electric.connect(token)
```

The `electrify` call returns a promise that will resolve to an `ElectricClient` for our database.
We call `connect` to connect the client to the Electric sync service.
The Electric client exposes the following interface:

```ts
interface ElectricClient<DB> {
  db: ClientTables<DB> & RawQueries
  connect(token?: string): Promise<void>
  disconnect(): void
}

export type ClientTables<DB> = {
  users: UsersTable
  projects: ProjectsTable
  memberships: MembershipsTable
  issues: IssuesTable
  comments: CommentsTable
}

interface RawQueries {
  rawQuery(sql: Statement): Promise<Row[]>
  liveRawQuery(sql: Statement): LiveResultContext<any>
  unsafeExec(sql: Statement): Promise<Row[]>
}

type Statement = {
  sql: string
  args?: BindParams
}

```

The Electric client above defines a property for every table in our data model: `electric.db.users`, `electric.db.projects`, etc.
The API of these tables is explained below when we discuss the [supported queries](#queries).
In addition, one can execute raw read-only SQL queries using the `electric.db.rawQuery` and `electric.db.liveRawQuery` escape patches.
It is also possible to execute raw queries that can modify the store using `electric.db.unsafeExec`, but it should be used with caution as the changes are unchecked and may cause the sync service to stop if they are ill-formed.
Therefore, only use raw queries for features that are not supported by our regular API.

## Connectivity methods

The Electric client provides two connectivity methods:
- `connect(token?: string)`: connects to Electric using the provided token. Can be used to reconnect to Electric in case the connection breaks; if the token is not provided the previous one is used.
- `disconnect()`: disconnects from Electric. Can be used to go into offline mode.

## Configuration

The Electric client has a few configuration options that are defined on the `ElectricConfig` type available in
`electric-sql/config`. At a minimum, you have to include in the config object the URL to your instance of the
[sync service](../../usage/installation/service), for example:

```ts
const config: ElectricConfig = {
  url: 'http://my-app-domain',
}
```

### Available options

- `auth?: AuthConfig`

   Authentication object that includes an optional client id `clientId`.

   `clientId` is a unique identifier for this particular client or device. If omitted, a random UUID will be generated
   the first time this client connects to the sync service.

- `url?: string` (default: `"http://localhost:5133"`)

   URL of the Electric sync service to connect to.

   Should have the following format:

   ```
   protocol://<host>:<port>[?ssl=true]
   ```

   If the protocol is `https` or `wss` then `ssl` defaults to true. Otherwise it defaults to false.

   If port is not provided, defaults to 443 when ssl is enabled or 80 when it isn't.

- `debug?: boolean` (default: `false`)

  Activate debug mode which logs the replication messages that are exchanged between the client and the sync service.

- `timeout?: number` (default: `3000`)

  Timeout (in milliseconds) for RPC requests.

  Needs to be large enough for the server to have time to deliver the full initial subscription data
  when the client subscribes to a shape for the first time.


- `connectionBackOffOptions?: ConnectionBackOffOptions`

   Configuration of the backoff strategy used when trying to reconnect to the Electric sync service after a failed
   connection attempt.

### Configuring example apps

In our example apps and in apps created with `npx create-electric-app`, the `url` and `debug` options are looked up as
`ELECTRIC_URL` and `DEBUG_MODE` environment variables, respectively.

So, for example, to include the URL of a hosted instance of Electric into the production build of your app, put it in
the `ELECTRIC_URL` environment variable when running your build command:

```shell
ELECTRIC_URL=https://my-app-domain.com npm run build
# or
ELECTRIC_URL=wss://my-app-domain.com npm run build
```

To run your app in development with debug mode enabled:

```shell
ELECTRIC_URL=http://localhost:5133 DEBUG_MODE=true npm run dev
```

## Shapes

Shapes define the portion of the database that syncs to the user's device.
Initially, users are not subscribed to any shape.
Tables can be synced by requesting new shape subscriptions.

### `sync`

Once we are connected to the sync service we can request a new shape subscription using the `sync` method on database tables.
We can sync a single table:
```ts
const { synced } = await electric.db.comments.sync()
// shape request was acknowledged by the server
// waiting for the data to be delivered...
await synced
// now the shape data has been delivered
```

Or we can sync several tables using one shape:
```ts
const { synced } = await electric.db.projects.sync({
  include: {
    owner: true
  }
})
await synced
// data for both tables got delivered
```

The code snippet above subscribes to a shape containing the `projects` table as well as the `users` table
since we explicitly included the `owner`s of projects.
We can achieve the same using two separate shape subscriptions:

```ts
const { synced: sync1 } = await electric.db.projects.sync()
const { synced: sync2 } = await electric.db.users.sync()
await sync1
// data for projects table has been delivered
await sync2
// data for users table has been delivered
```

This approach differs from the previous code snippet because the data for the `projects` and `users` tables
is delivered independently, whereas, in the previous example they are deliver together as one database transaction.

When a table is not yet synced, it exists on the device's local database but is empty.
If you try to read from an unsynced table you will get empty results and a warning will be logged:
> Reading from unsynced table memberships

## Queries

As explained before, every Electric client contains a `db` property representing the electrified database.
The `db` object defines a property for every database table; e.g. `electric.db.issues`
corresponds to the `issues` table in the database.

Each table supports a variety of queries to create, read, update, and delete data.
The interface definition of these queries can be found on our [GitHub repository](https://github.com/electric-sql/electric/blob/main/clients/typescript/src/client/model/model.ts).
Below, we demonstrate the different queries using the issue tracking application example.

<!---
### API

Here is the complete list of supported methods:

```ts
// sync a shape
sync(i?: T): Promise<ShapeSubscription>
// create a single data record
create<T extends CreateInput<CreateData, Select, Include>>(
  i: SelectSubset<T, CreateInput<CreateData, Select, Include>>
): Promise<Kind<GetPayload, T>>
// create several data records
createMany<T extends CreateManyInput<CreateData>>(
  i: SelectSubset<T, CreateManyInput<CreateData>>
): Promise<BatchPayload>
// find a unique record
findUnique<T extends FindUniqueInput<Select, WhereUnique, Include>>(
  i: SelectSubset<T, FindUniqueInput<Select, WhereUnique, Include>>
): Promise<Kind<GetPayload, T> | null>
// find the first matching record
findFirst<
  T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
>(
  i: SelectSubset<
    T,
    FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >
): Promise<Kind<GetPayload, T> | null>
// find all matching records
findMany<
  T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
>(
  i: SelectSubset<
    T,
    FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >
): Promise<Array<Kind<GetPayload, T>>>

// Below are live variants of the read queries above
liveUnique<T extends FindUniqueInput<Select, WhereUnique, Include>>(
  i: SelectSubset<T, FindUniqueInput<Select, WhereUnique, Include>>
): () => Promise<LiveResult<Kind<GetPayload, T> | null>>

liveFirst<
  T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
>(
  i: SelectSubset<
    T,
    FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >
): () => Promise<LiveResult<Kind<GetPayload, T> | null>>

liveMany<
  T extends FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
>(
  i: SelectSubset<
    T,
    FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >
): () => Promise<LiveResult<Array<Kind<GetPayload, T>>>>

// update a uniquely identified record
update<T extends UpdateInput<UpdateData, Select, WhereUnique, Include>>(
  i: SelectSubset<T, UpdateInput<UpdateData, Select, WhereUnique, Include>>
): Promise<Kind<GetPayload, T>>
// update all matching records
updateMany<T extends UpdateManyInput<UpdateData, Where>>(
  i: SelectSubset<T, UpdateManyInput<UpdateData, Where>>
): Promise<BatchPayload>
// create a new data record or update if already exists
upsert<
  T extends UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
>(
  i: SelectSubset<
    T,
    UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
  >
): Promise<Kind<GetPayload, T>>
// delete a uniquely identified record
delete<T extends DeleteInput<Select, WhereUnique, Include>>(
  i: SelectSubset<T, DeleteInput<Select, WhereUnique, Include>>
): Promise<Kind<GetPayload, T>>
// delete all matching records
deleteMany<T extends DeleteManyInput<Where>>(
  i: SelectSubset<T, DeleteManyInput<Where>>
): Promise<BatchPayload>
```

Note that the interface shown above is generic,
the concrete types depend on the type of your database table.

Each API method is discussed below for a concrete `issues` table.
-->

### `create`

`create` creates a single database record and returns the created record (or a selection of the created record's fields if the `select` argument is used).
Accepts an object containing the following arguments:

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `data` | `XOR<IssueCreateInput, IssueUncheckedCreateInput>` | Yes | An object representing the record to be inserted. This object must contain a value for all non-nullable fields and may contain relation fields in order to perform nested transactional insertions. |
| `select` | `IssueSelect` | No | A selection of fields to include in the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included. |

#### Examples

We can use `create` to create a new issue:

```ts
await electric.db.issues.create({
  data: {
    id: "0c67311d-196e-4504-b64d-27fa59679a65",
    title: "Create my first Electric app",
    project_id: "9c0f2a8f-0d8b-405d-8278-b1b2f200e7d2"
  }
})
```

Similarly, we can create an issue and limit the fields that are returned:

```ts
const { id, title } = await electric.db.issues.create({
  data: {
    id: "0c67311d-196e-4504-b64d-27fa59679a65",
    title: "Create my first Electric app",
    project_id: "9c0f2a8f-0d8b-405d-8278-b1b2f200e7d2"
  },
  select: {
    id: true,
    title: true
  }
})
```

Or, we can include related fields on the returned object:

```ts
await electric.db.issues.create({
  data: {
    id: "0c67311d-196e-4504-b64d-27fa59679a65",
    title: "Create my first Electric app",
  },
  include: {
    project: true
  }
})
```

We can also create an issue and the project it belongs to:

```ts
await electric.db.issues.create({
  data: {
    id: "0c67311d-196e-4504-b64d-27fa59679a65",
    title: "Create my first Electric app",
    project: {
      create: {
        id: "9c0f2a8f-0d8b-405d-8278-b1b2f200e7d2",
        name: "My project",
        owner_id: "Alice"
      }
    }
  }
})
```

### `createMany`

`createMany` creates one or more database records within one transaction.
Returns a count of how many records were created.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `data` | <code>IssueCreateManyInput &#124; IssueCreateManyInput[]</code> | Yes | One or more records to create. Records must contain values for all non-nullable fields and may include related fields to perform nested inserts transactionally. |
| `skipDuplicates` | `boolean` | No | Do not create records for which a unique field or ID field already exists. Thereby, ignoring records that are conflicting. |

#### Examples

Create a single issue:

```ts
const { count } = await electric.db.issues.createMany({
  data: {
    id: "0c67311d-196e-4504-b64d-27fa59679a65",
    title: "Create my first Electric app",
  }
})
```

Create multiple issues:

```ts
const { count } = await electric.db.issues.createMany({
  data: [
    {
      id: "0c67311d-196e-4504-b64d-27fa59679a65",
      title: "Create my first Electric app",
    },
    {
      id: "5252f22d-4223-4b18-be1c-b149f21e6f5c",
      title: "Improve the app",
    },
  ]
})
```

Ignore conflicting records:

```ts
const id = "0c67311d-196e-4504-b64d-27fa59679a65"
const { count } = await electric.db.issues.createMany({
  data: [
    {
      id,
      title: "Create my first Electric app",
    },
    {
      id,
      title: "Improve the app",
    },
  ],
  skipDuplicates: true
})
console.log(count) // prints 1 because the 2nd record has the same ID
                   // as the first one so it is ignored
```

### `findUnique`

`findUnique` retrieves a single and uniquely identified database record.
Returns the record if it is found and `null` otherwise.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `where` | `IssueWhereUniqueInput` | Yes | One or more fields that uniquely identify a record. |
| `select` | `IssueSelect` | No | A selection of fields to include on the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included. |

#### Examples

Using the `where` argument we can fetch a record by its unique identifier or by a combination of fields
that uniquely identify the record:
```ts
const result = await electric.db.issues.findUnique({
  where: {
    id: 5
  }
})
```

If we are only interested in the author's name we can use `select`:
```ts
const { author } = await electric.db.issues.findUnique({
  where: {
    id: 5
  },
  select: {
    author: true
  }
})
```

And if we want to also get the issue's comments and their authors we can use `include`:
```ts
const issueWithCommentsAndTheirAuthor = await electric.db.issues.findUnique({
  where: {
    id: 5
  },
  include: {
    comments: {
      include: {
        author: true
      }
    }
  }
})
```

### `findFirst`

`findFirst` returns the first data record from the list of data records that match the query.
Returns a record if one was found and `null` otherwise.
`findFirst` is equivalent to `findMany` with argument `take: 1`.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `where` | `IssueWhereInput` | No | Fields on which to filter the records. |
| `select` | `IssueSelect` | No | A selection of fields to include on the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included. |
| `orderBy` | <code>IssueOrderByInput &#124; IssueOrderByInput[]</code> | No | Order the list of matching records by the specified properties. |
| `skip` | `number` | No | Number of records to skip from the list of matching records. |
| `distinct` | <code>IssueDistinctFieldEnum[]</code> | No | Filter duplicates based on one or more fields. |

#### Examples

Get an issue of some project:

```ts
await electric.db.issues.findFirst({
  where: {
    project: {
      id: '17b1daef-07b3-4689-9e73-5af05474f17d'
    }
  }
})
```

To get the first issue of some project we can use `orderBy` to order on ascending time of insertion:

```ts
await electric.db.issues.findFirst({
  where: {
    project: {
      id: '17b1daef-07b3-4689-9e73-5af05474f17d'
    }
  },
  orderBy: {
    inserted_at: 'asc'
  }
})
```

Similarly, we can get the latest issue of some project using `orderBy` to order on descending time of insertion:

```ts
await electric.db.issues.findFirst({
  where: {
    project: {
      id: '17b1daef-07b3-4689-9e73-5af05474f17d'
    }
  },
  orderBy: {
    inserted_at: 'desc'
  }
})
```

And if we want to get the 2nd latest issue of some project we can combine `orderBy` with `skip: 1`:

```ts
await electric.db.issues.findFirst({
  where: {
    project: {
      id: '17b1daef-07b3-4689-9e73-5af05474f17d'
    }
  },
  orderBy: {
    inserted_at: 'desc'
  },
  skip: 1
})
```

### `findMany`

`findMany` returns a list of all data records that match the query.
It supports the same arguments as `findFirst` with the addition of `take`.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `where` | `IssueWhereInput` | No | Fields on which to filter the records. |
| `select` | `IssueSelect` | No | A selection of fields to include on the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included. |
| `orderBy` | <code>IssueOrderByInput &#124; IssueOrderByInput[]</code> | No | Order the list of matching records by the specified properties. |
| `skip` | `number` | No | Number of records to skip from the list of matching records. |
| `distinct` | <code>IssueDistinctFieldEnum[]</code> | No | Filter duplicates based on one or more fields. |
| `take` | `number` | No | Number of matching data records to return. |

#### Examples

We can fetch all issues:

```ts
await electric.db.issues.findMany() // equivalent to passing an empty object {}
```

We can also use `take` to limit the results to the first 5 issues:

```ts
await electric.db.issues.findMany({
  take: 5
})
```

### `update`

`update` updates a uniquely identified database record and returns the updated record.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `data` | `XOR<IssueUpdateInput, IssueUncheckedUpdateInput>` | Yes | Object containing the fields to be updated. |
| `where` | `IssueWhereUniqueInput` | Yes | One or more fields that uniquely identify the record. |
| `select` | `IssueSelect` | No | A selection of fields to include in the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included in the returned object. |

#### Examples

We can use `update` to update the title of a specific issue:

```ts
await electric.db.issues.update({
  data: {
    title: 'Updated issue title'
  },
  where: {
    id: '17b1daef-07b3-4689-9e73-5af05474f17'
  }
})
```

We can also update an issue and one of its comments by using a nested `update`:

```ts
await electric.db.issues.update({
  data: {
    title: 'Updated issue title',
    comments: {
      update: {
        data: {
          text: 'Updated comment text'
        },
        where: {
          author_id: '422bfea3-2a1f-45ae-b6f9-3efeec4a5864'
        }
      }
    }
  },
  where: {
    id: '6a87a816-4b8c-48e5-9ccf-eaf558032d82'
  }
})
```

We can also update an issue and *all* or *several* of its comments by using a nested `updateMany`:

```ts
await electric.db.issues.update({
  data: {
    title: 'Updated issue title',
    comments: {
      updateMany: {
        data: {
          text: 'Updated comment text'
        }
      }
    }
  },
  where: {
    id: '6a87a816-4b8c-48e5-9ccf-eaf558032d82'
  }
})
```

We can even nest several queries by providing an array of nested `update` and/or `updateMany` queries.
The following query updates an issue and two of its comments:

```ts
await electric.db.issues.update({
  data: {
    title: 'Updated issue title',
    comments: {
      update: [
        {
          data: {
            text: 'Updated comment text'
          },
          where: {
            id: 'f4ec1d54-664d-40e8-bc64-2736fb3c14b3'
          }
        },
        {
          data: {
            text: "Updated another comment's text"
          },
          where: {
            id: '15d1cf30-80c3-4fb8-bcbf-a681171d134f'
          }
        }
      ]
    }
  },
  where: {
    id: '6a87a816-4b8c-48e5-9ccf-eaf558032d82'
  }
})
```

Note that updates can be arbitrarily nested, i.e., there is no limit to the number of nested updates.

### `updateMany`

`updateMany` updates several database records and returns a count indicating how many records were updated.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `data` | `XOR<IssueUpdateManyMutationInput, IssueUncheckedUpdateManyInput>` | Yes | Object containing the fields to be updated. |
| `where` | `IssueWhereInput` | No | Filters the database records based on the provided field values. |

#### Examples

`updateMany` can be used to update all database records:

```ts
await electric.db.issues.updateMany({
  data: {
    description: 'Default description for all issues'
  }
})
```

or it can be used to update certain database records, e.g, all issues of a project:

```ts
await electric.db.issues.updateMany({
  data: {
    description: 'Default description for all issues of this project'
  },
  where: {
    project_id: '6c0b6320-830e-42f8-937d-da389e9591e3'
  }
})
```

### `upsert`

`upsert` updates a uniquely identified database record if it exists and creates it otherwise.
`upsert` returns the updated/created record.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `create` | `XOR<IssueCreateInput, IssueUncheckedCreateInput>` | Yes | An object representing the record to be inserted. This object must contain a value for all non-nullable fields and may contain relation fields in order to perform nested transactional insertions. |
| `update` | `XOR<IssueUpdateInput, IssueUncheckedUpdateInput>` | Yes | Object containing the fields to be updated. |
| `where` | `IssueWhereUniqueInput` | Yes | One or more fields that uniquely identify the record. |
| `select` | `IssueSelect` | No | A selection of fields to include in the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included in the returned object. |

#### Examples

We can use `upsert` to update or create a new issue:

```ts
const issue = await electric.db.issues.upsert({
  create: {
    id: '0c67311d-196e-4504-b64d-27fa59679a65',
    title: 'Create my first Electric app',
    project_id: '9c0f2a8f-0d8b-405d-8278-b1b2f200e7d2'
  },
  update: {
    title: 'Create my first Electric app'
  },
  where: {
    id: '0c67311d-196e-4504-b64d-27fa59679a65'
  }
})
```

### `delete`

`delete` deletes a uniquely identified database record and returns the deleted record.
If the record to be deleted is not found, `delete` throws an `InvalidArgumentError`.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `where` | `IssueWhereUniqueInput` | Yes | One or more fields that uniquely identify the record. |
| `select` | `IssueSelect` | No | A selection of fields to include in the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included in the returned object. |

#### Examples

We can delete a specific issue:

```ts
const issue = await electric.db.issues.delete({
  where: {
    id: '0c67311d-196e-4504-b64d-27fa59679a65'
  }
})
```

### `deleteMany`

`deleteMany` deletes all database records that match the query and returns a count indicating how many records were deleted.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `where` | `IssueWhereInput` | No | Filters the database records based on the provided field values. |

#### Examples

We can use `deleteMany` to delete all issues:

```ts
const { count } = await electric.db.issues.deleteMany()
```

or only delete the issues belonging to a certain project:

```ts
const { count } = await electric.db.issues.deleteMany({
  where: {
    project_id: '9c0f2a8f-0d8b-405d-8278-b1b2f200e7d2'
  }
})
```

## Live Queries

The queries discussed above are examples of one-off queries.
However, often times applications need to react to live changes of the data.
To this end, the Electric client supports live versions for all find queries.
Live queries are integrated with React by means of the `useLiveQuery` hook:

```ts
import { useLiveQuery } from 'electric-sql/react'
const { results } = useLiveQuery(db.issues.liveMany())
```

The live query above fetches all issues.
The `results` variable will automatically be updated
when new issues are created and when existing issues are updated or deleted.

The `useLiveQuery` hook can be used in combination with any live query.
The supported live queries are discussed below.

### `liveUnique`

Live version of the `findUnique` query.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `where` | `IssueWhereUniqueInput` | Yes | One or more fields that uniquely identify the record. |
| `select` | `IssueSelect` | No | A selection of fields to include on the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included. |

### `liveFirst`

Live version of the `findFirst` query.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `where` | `IssueWhereInput` | No | Fields on which to filter the records. |
| `select` | `IssueSelect` | No | A selection of fields to include on the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included. |
| `orderBy` | <code>IssueOrderByInput &#124; IssueOrderByInput[]</code> | No | Order the list of matching records by the specified properties. |
| `skip` | `number` | No | Number of records to skip from the list of matching records. |
| `distinct` | <code>IssueDistinctFieldEnum[]</code> | No | Filter duplicates based on one or more fields. |

### `liveMany`

Live version of the `findMany` query.

#### Options

| Name | Example type | Required | Description |
|------|--------------|----------|-------------|
| `where` | `IssueWhereInput` | No | Fields on which to filter the records. |
| `select` | `IssueSelect` | No | A selection of fields to include on the returned object. |
| `include` | `IssueInclude` | No | Specifies relations to be included. |
| `orderBy` | <code>IssueOrderByInput &#124; IssueOrderByInput[]</code> | No | Order the list of matching records by the specified properties. |
| `skip` | `number` | No | Number of records to skip from the list of matching records. |
| `distinct` | <code>IssueDistinctFieldEnum[]</code> | No | Filter duplicates based on one or more fields. |
| `take` | `number` | No | Number of matching data records to return. |

<!---
### `discover`

### `raw`

### `rawMany`
-->

## Advanced examples

We now provide a number of advanced examples regarding the `orderBy` and `distinct` options
supported by several of the queries documented above.

### Grouping and ordering with `orderBy`

Sometimes we need to order query results based on some field.
To this end, we can chose to sort any field in ascending (`'asc'`) or descending (`'desc'`) order:

```ts
await electric.db.issues.findMany({
  orderBy: {
    title: 'asc'
  }
})
```

The above query fetches all issues and sorts them in ascending lexicographical order of their title.

We can also sort on several fields.
For instance, we can group issues by project and sort the issues of each project on their title:

```ts
await electric.db.issues.findMany({
  orderBy: [
    {
      project_id: 'asc'
    },
    {
      title: 'asc'
    }
  ]
})
```

### Selecting distinct records with `distinct`

We can select distinct records based on one or more fields using `distinct`.
For example, we can fetch distinct issue titles and include their comments:

```ts
await electric.db.projects.findMany({
  distinct: ['title'],
  include: {
    comments: true
  }
})
```

The above query will return only 1 record per distinct issue title so if two issues have the same title, it will return only one of them.
We can also fetch distinct issues based on both their title and description:

```ts
await electric.db.projects.findMany({
  distinct: ['title', 'description'],
  include: {
    comments: true
  }
})
```

Now, if there are two issues with the same title but different descriptions, the query will return both issues.

## Operators

Electric clients support a variety of operators that can be applied to strings, numbers, and datetimes.

### `gt` / `gte`

Greater than operator:

```ts
{
  where: {
    age: {
      gt: 17
    }
  }
}
```

Greater than or equal operator:

```ts
{
  where: {
    name: {
      gte: 18
    }
  }
}
```

### `lt` / `lte`

Lesser than operator:

```tsx
{
  where: {
    age: {
      lt: 66
    }
  }
}
```

Lesser than or equal operator:

```tsx
{
  where: {
    age: {
      lte: 65
    }
  }
}
```

### Equality operator

Equality is expressed via direct assignment to the column name:

```ts
{
  where: {
    username: 'Alice'
  }
}
```

### `not`

Inequality can be expressed using `not`:

```ts
{
  where: {
    username: {
      not: 'Alice'
    }
  }
}
```

### `in` / `notIn`

We can use `in` to check that the value is part of a list of values:

```ts
{
  where: {
    username: {
      in: ['Alice', 'Bob']
    }
  }
}
```

We can use `notIn` to check that the value is not part of a list of values:

```ts
{
  where: {
    username: {
      notIn: ['Alice', 'Bob']
    }
  }
}
```

### `startsWith`

`startsWith` checks that the string starts with a given prefix:

```ts
where: {
  title: {
    startsWith: 'The'
  }
}
```

### `endsWith`

`endsWith` checks that the string ends with a given suffix:

```ts
where: {
  title: {
    endsWith: 'documentation'
  }
}
```

### `contains`

`contains` checks that the string contains a given string:

```ts
where: {
  title: {
    contains: 'ElectricSQL'
  }
}
```

### `AND` / `OR` / `NOT`

Combining operators such as `AND`, `OR`, and `NOT` are supported.
Operators can be combined as multiple parts of the same clause, e.g.:

```ts
{
  where: {
    age: {
      gte: 18,
      lte: 65
    }
  }
}
```

The same can be achieved by using `AND` explicitly:

```ts
{
  where: {
    AND: [
      {
        name: {
          gte: 18,
        }
      },
      {
        name: {
          lte: 65,
        }
      },
    ]
  }
}
```

Operators can also be combined using `OR`:

```ts
{
  where: {
    OR: [
      {
        age: {
          lt: 18,
        }
      },
      {
        name: {
          gt: 65,
        }
      },
    ]
  }
}
```

Operators can be negated using `NOT`:

```ts
{
  where: {
    NOT: [
      {
        age: {
          lt: 18,
        }
      },
      {
        name: {
          gt: 65,
        }
      },
    ]
  }
}
```

`NOT` applies to every condition in the list,
so the above example filters out users under the age of 18 as well as users above the age of 65.
