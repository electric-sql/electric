---
title: Docker
description: >-
  Open platform for developing, shipping, and running applications.
sidebar_position: 10
---

The Electric sync service is [packaged using Docker](https://github.com/electric-sql/electric/blob/main/components/electric/Dockerfile) and published to Docker Hub at [hub.docker.com/r/electricsql/electric](https://hub.docker.com/r/electricsql/electric).

The configuration options are documented at <DocPageLink path="api/service" />. For example:

```shell
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -e "LOGICAL_PUBLISHER_HOST=..." \
    -e "AUTH_JWT_ALG=HS512" \
    -e "AUTH_JWT_KEY=..." \
    -p 5133:5133 \
    -p 5433:5433 \
    electricsql/electric
```

If you'd like to run Electric and Postgres together in Docker, see the example Docker Compose files in [examples/starter/template/backend/compose](https://github.com/electric-sql/electric/tree/main/examples/starter/template/backend/compose).
