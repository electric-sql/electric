## Quickstart

Run a fresh Postgres and Electric using [Docker Compose](https://docs.docker.com/compose).

Download and run this [docker-compose.yaml](https://github.com/electric-sql/electric/blob/main/website/public/docker-compose.yaml) file:

```sh
curl -O https://electric-sql.com/docker-compose.yaml
docker compose up
```

### Create a table and insert some data

```sh
psql "postgresql://postgres:password@localhost:54321/electric"
```

```sql
CREATE TABLE foo (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  value FLOAT
);
```

```sql
INSERT INTO foo (name, value) VALUES
  ('Alice', 3.14),
  ('Bob', 2.71);
```

### Using the HTTP API

Use `curl` to request a [Shape](/docs/guides/shapes) containing all rows in the `foo` table:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&offset=-1'
```

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
      table: `foo`,
    },
  })

  return <pre>{JSON.stringify(data, null, 2)}</pre>
}

export default Component
```

Run the dev server:

```sh
npm run dev
```

Congratulations! You've built your first real-time, reactive Electric app!
