---
title: Docker
description: >-
  Open platform for developing, shipping, and running applications.
sidebar_position: 10
---

The Electric sync service is [packaged using Docker](https://github.com/electric-sql/electric/blob/main/components/electric/Dockerfile) and published to Docker Hub at [hub.docker.com/r/electricsql/electric](https://hub.docker.com/r/electricsql/electric).

See <DocPageLink path="usage/installation/service" /> to get familiar with configuring and running the sync service with Docker. An example invocation would be:

```shell
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -e "LOGICAL_PUBLISHER_HOST=..." \
    -e "PG_PROXY_PASSWORD=..." \
    -e "AUTH_JWT_ALG=HS512" \
    -e "AUTH_JWT_KEY=..." \
    -p 5133:5133 \
    -p 5433:5433 \
    -p 65432:65432 \
    -t \
    electricsql/electric
```

Alternatively, using Docker Compose we can configure an instance of the Electric sync service in a `compose.yaml` file stored locally and deploy it to a remote machine that has the Docker daemon running. See instructions for deploying Electric to a [Digital Ocean Droplet](digital-ocean#deploying-electric-using-docker-compose) for an example of such setup.
