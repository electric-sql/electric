Make sure you have Docker and Node.js (>=16.11) and then:

```shell
npx create-electric-app@latest my-app --template react
```

You can specify the desired template, available options are `react` and `vue`. Change directory into `my-app` and start the backend services. This will use Docker Compose to run [Postgres](../usage/installation/postgres.md) and the [Electric sync service](../usage/installation/service.md):

```shell
cd my-app
npx electric-sql start --with-postgres
# Aliased in package.json as `npm run backend:start`
```

Open another terminal tab, navigate back to the `my-app` directory and create the database schema (defined in `./db/migrations`):

```shell
npm run db:migrate
```

Generate your [type-safe database client](../usage/data-access/client.md):

```shell
npx electric-sql generate
# Aliased in package.json as `npm run client:generate`
```

Start your app:

```shell
npm run dev
```

<!-- see https://vitejs.dev/config/server-options#server-port for default Vite port -->
Open [localhost:5173](http://localhost:5173) in your web browser. That's it, you're up and running&nbsp;:)
