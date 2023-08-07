<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

# ElectricSQL - Web example

This is an example web application using ElectricSQL in the browser with [wa-sqlite](https://github.com/rhashimoto/wa-sqlite).

## Install

Clone this repo and change directory into this folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/web-wa-sqlite
```

Install the dependencies:

```sh
pnpm install
```

## Run

First, setup and run the local stack:

```sh
cd ../../components/electric
docker build -t electric:local-build .
cd ../../local-stack
```

Configure your environment to use the compiled image:

```sh
vim .envrc
export ELECTRIC_IMAGE=electric:local-build
```

Launch the local stack:

```sh
source .envrc
docker-compose up
```

Then, in another terminal, connect to Postgres and create the necessary tables:

```sh
docker exec -it -e PGPASSWORD=password local-stack-postgres_1-1  psql -h 127.0.0.1 -U postgres -d electric
electric=# CREATE TABLE IF NOT EXISTS "items" (
  "value" TEXT NOT NULL,
  CONSTRAINT "items_pkey" PRIMARY KEY ("value")
);
```

Now, Electrify the table in order for it to be exposed to client applications:

```
electric=# CALL electric.electrify('items');
```

Then, build the typescript client and the generator:

```sh
cd clients/typescript
pnpm build
cd ../../generator
pnpm build
```

Now, generate an Electric client for the app:

```sh
cd ../examples/web-wa-sqlite
npx electric-sql generate
```

The `generate` command fetches the migrations from the backend and generates an Electric client in `src/generated/client/index.ts`.

Now, let's build and run the app:

```sh
pnpm build
pnpm start
```

## Sync

The application is set up to work with the local stack.

Run the local stack.
Then open [localhost:3001](http://localhost:3001) in two different browsers (so they're backed by different databases) and try it out. You'll see data being replicated between the client applications.

See [Running the Examples](https://electric-sql.com/docs/overview/examples) for information on how to:

- [connect to your own sync service](https://electric-sql.com/docs/overview/examples#option-2--connect-to-your-own-sync-service)
- [run the backend locally](https://electric-sql.com/docs/overview/examples#option-3--run-the-backend-locally)

## Notes on the code

In this example, Electric uses wa-sqlite in the browser with IndexedDB for persistence.

The main code to look at is in [`./src/Example.tsx`](./src/Example.tsx):

```tsx
export const Example = () => {
  const [ electric, setElectric ] = useState<Electric>()
  
  useEffect(() => {
    const init = async () => {
      const conn = await ElectricDatabase.init('electric.db', '')
      const db = await electrify(conn, schema, config)
      setElectric(db)
    }
    init()
  }, [])

  if (electric === undefined) {
    return null
  }

  return (
    <ElectricProvider db={electric}>
      <ExampleComponent />
    </ElectricProvider>
  )
}
```

This opens an electrified database client and passes it to the application using the React Context API. Components can then use the [`useElectric`](https://electric-sql.com/docs/usage/frameworks#useelectric-hook) and `useLiveQuery` hooks to access the database client and bind reactive queries to the component state.

```tsx
const ExampleComponent = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(db.items.liveMany({})) // read all items

  const addItem = async () => {
    await db.items.create({
      data: {
        value: crypto.randomUUID(),
      }
    })
  }

  const clearItems = async () => {
    await db.items.deleteMany() // delete all items
  }
  
  return (
    <div>
      <div className='controls'>
        <button className='button' onClick={addItem}>
          Add
        </button>
        <button className='button' onClick={clearItems}>
          Clear
        </button>
      </div>
      {results && results.map((item: any, index: any) => (
        <p key={ index } className='item'>
          <code>{ item.value }</code>
        </p>
      ))}
    </div>
  )
}
```

## Migrating the app

ElectricSQL supports migrating the back-end while the app is running.
Migrations are additive-only.
For example, while running the app we may connect to the Postgres backend and add a column `other_value` to the `items` table:

```shell
docker exec -it -e PGPASSWORD=password local-stack-postgres_1-1  psql -h 127.0.0.1 -U postgres -d electric
electric=# ALTER TABLE items ADD other_value TEXT;
WARNING:  assigning automatic migration version id: 20230529120539_974
ALTER TABLE
```

This database migration will automatically be picked up by Electric and will be streamed to the application
which will apply the migration on its local SQLite database.
Since we only support additive migrations, the application continues to work.

Then, remains to update the code of our application to do something with the new column.
To this end, first run the `generate` script from within the top-level directory of this app:

```shell
npx electric-sql generate
```

The `generate` script updates the Electric client to incorporate the new column `other_value` on the `items` table.
This new column is now also reflected in the type of the `items` table.
If the application was offline when the backend was migrated,
the missing migrations will automatically be fetched by the above script
and will be applied the next time the application is started.

Now, let's update the app. In `Example.tsx`, modify the `addItem` function to provide a value for the new column:

```typescript
const addItem = async () => {
  await db.items.create({
    data: {
      value: crypto.randomUUID(),
      other_value: crypto.randomUUID(), // <-- insert value in new row
    }
  })
}
```

Also modify the returned HTML to display the value of the new column:

```typescript jsx
{results && results.map((item: any, index: any) => (
  <p key={ index } className='item'>
    <code>{ item.value } - { item.other_value }</code>
  </p>
))}
```

You now successfully migrated your app, simply build it again and run the app 🚀

## More information

See the [documentation](https://electric-sql.com/docs) and [community guidelines](https://github.com/electric-sql/meta). If you need help [let us know on Discord](https://discord.electric-sql.com).
