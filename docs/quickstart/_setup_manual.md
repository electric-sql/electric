You need to have a Postgres database, run the Electric sync service and develop using the Typescript client.

### Postgres database

ElectricSQL works with any Postgres that has logical replication enabled. [Crunchy Data](https://www.crunchydata.com/pricing/calculator) provides a good hosted Postgres service (with a free tier and logical replication enabled by default). Or run it yourself, e.g.: using Docker:

```shell
docker run \
    -e "POSTGRES_PASSWORD=..." \
    -c "wal_level=logical" \
    -p 5432:5432 \
    postgres
```

See <DocPageLink path="usage/installation/postgres" /> for more info.

### Electric sync service

Run the Electric sync service using Docker, for example:

```shell
docker pull electricsql/electric:latest
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -e "LOGICAL_PUBLISHER_HOST=..." \
    -e "PG_PROXY_PASSWORD=..." \
    -e "AUTH_MODE=insecure" \
    -p 5133:5133 \
    -p 5433:5433 \
    -p 65432:65432 \
    electricsql/electric
```

See <DocPageLink path="usage/installation/service" /> for more info.

### Typescript client

Add the `electric-sql` library to your web or mobile app, along with an [SQLite driver](../integrations/drivers/index.md):

```shell
npm install electric-sql
```

Add a prebuild script to your `package.json` to generate a type-safe database client:

```json
"scripts": {
  "prebuild": "npx electric-sql generate"
}
```

See <DocPageLink path="usage/installation/client" /> and <DocPageLink path="integrations/drivers" /> for more information.
