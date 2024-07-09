# Linearlite

## To run
start electric-next. e.g.

```bash
  cd sync_service
  docker compose -f dev/docker-compose.yml up
  iex -S mix
```

install deps for the example and load data

```bash
cd examples/linearlite
npm i
DATABASE_URL=postgresql://postgres:password@localhost:54321/postgres npm run migrate
npm run load-data
```

start the app

```bash
npm run dev
```
