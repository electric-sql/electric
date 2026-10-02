---
'@electric-sql/start': major
---

Set up a local Docker-based Postgres and Electric instead of provisioning Electric Cloud resources. The CLI now scaffolds the starter with a `.env` pointing at the services from its `docker-compose.yaml` and prints the steps to start them (`pnpm backend:up`), apply migrations and run the app. The `--source`, `--secret` and `--database-url` flags, the generated `claim` and `deploy:netlify` scripts and the Electric Cloud API helpers exported from the package have been removed.
