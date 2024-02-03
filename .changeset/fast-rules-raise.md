---
"electric-sql": patch
---

Use SIGINT as the default stop signal for the Electric service started with `npx electric-sql start`. This results in faster shutdown after pressing Ctrl-C or stopping all services with `docker compose stop/down`.
