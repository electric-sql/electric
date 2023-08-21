---
title: "Fly.io"
description: >-
  Deploy app servers close to your users.
sidebar_position: 40
---

You can deploy ElectricSQL to [Fly.io](https://fly.io) as a [Fly Machine](https://fly.io/docs/machines/) instance.

The machine needs ports `5050`, `5133` and `5433` exposed and the environment variables described in <DocPageLink path="api/service" /> configured.

For example, using a [`fly.toml`](https://fly.io/docs/reference/configuration/) file:

```toml
[build]
  image = "electricsql/electric:latest"

[env]
  DATABASE_URL = "postgresql://..."
  LOGICAL_PUBLISHER_HOST = "<your fly hostname>"
  AUTH_JWT_ALG = "HS512"
  AUTH_JWT_KEY = "<your signing key"

[http_service]
  internal_port = 5050
  force_https = true
  auto_stop_machines = false
  auto_start_machines = false

[[services]]
  internal_port = 5133
  auto_stop_machines = false
  auto_start_machines = false

  [[services.ports]]
    port = 5133

[[services]]
  internal_port = 5433
  auto_stop_machines = false
  auto_start_machines = false

  [[services.ports]]
    port = 5433
```
