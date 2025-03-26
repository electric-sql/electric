## Quickstart

Let's get you up-and-running with Electric and real-time sync of your Postgres data.

### Setup

We're going to run a fresh Postgres and Electric using [Docker Compose](https://docs.docker.com/compose).

Download and run this [docker-compose.yaml](https://github.com/electric-sql/electric/blob/main/website/public/docker-compose.yaml) file:

```sh
curl -O https://electric-sql.com/docker-compose.yaml
docker compose up
```

You can now start using Electric!

### Create a table and insert some data

Use a Postgres client to connect to Postgres. For example, with [psql](https://www.postgresql.org/docs/current/app-psql.html) you can run:

```sh
psql "postgresql://postgres:password@localhost:54321/electric"
```

Then create a `foo` table

```sql
CREATE TABLE foo (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  value FLOAT
);
```

And insert some rows:

```sql
INSERT INTO foo (name, value) VALUES
  ('Alice', 3.14),
  ('Bob', 2.71);
```

### Using the HTTP API

First let's try the low-level [HTTP API](/docs/api/http).

In a new terminal, use `curl` to request a [Shape](/docs/guides/shapes) containing all rows in the `foo` table:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&offset=-1'
```

Success! You should see the data you just put into Postgres in the shape response.

At this point, you could continue to fetch data using HTTP requests. However, let's switch up to fetch the same shape to use in a React app instead.

### Using the React client library

Run the following to create a standard React app:

```sh
npm create --yes vite@latest react-app -- --template react-ts
```

Change into the `react-app` subfolder and install the `@electric-sql/react` package:

```sh
cd react-app
npm install @electric-sql/react
```

Replace the contents of `src/App.tsx` with the following. Note that we're requesting the same shape as before:

```tsx
import { useShape } from '@electric-sql/react'

function Component() {
  const { data } = useShape({
    url: `http://localhost:3000/v1/shape`,
    params: {
      table: `foo`
    }
  })

  return (
    <pre>{ JSON.stringify(data, null, 2) }</pre>
  )
}

export default Component
```

Finally run the dev server to see it all in action!

```sh
npm run dev
```

### Postgres as a real-time database

Go back to your Postgres client and update your data. It'll instantly be synced to your component!

Congratulations! You've built your first real-time, reactive Electric app!