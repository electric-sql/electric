Make sure you have Docker and Node.js (>=16.11) and then:

```shell
npx create-electric-app@latest my-app
```

Change directory into `my-app` and start the backend services. This will use Docker Compose to run [Postgres](../usage/installation/postgres.md) and the [Electric sync service](../usage/installation/service.md):

```shell
cd my-app
yarn backend:start
```

Open another terminal tab, navigate back to the `my-app` directory and create the database schema (defined in `./db/migrations`):

```shell
yarn db:migrate
```

Generate your [type-safe database client](../usage/data-access/client.md):

```shell
yarn client:generate
```

Start your app:

```shell
yarn start
```

Open [localhost:3001](http://localhost:3001) in your web browser. That's it, you're up and running&nbsp;:)
