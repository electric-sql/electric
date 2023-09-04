---
title: Render
description: >-
  Cloud application hosting for developers.
sidebar_position: 20
---

Unfortunately, currently, deployment to [Render.com](https://render.com) is not possible. We hope to be able to deploy to Render very soon, pending support for either of these feature requests:

1. [Allow for Postgres logical replication](https://feedback.render.com/features/p/allow-for-postgres-logical-replication)
2. [Allow connecting to non-HTTP services from outside Render](https://feedback.render.com/features/p/allow-connecting-to-non-http-services-from-outside-render)

The [Electric sync service](../../api/service.md) is a web service that exposes multiple ports. On Render, public [Web Services](https://render.com/docs/web-services) are only available over HTTP(s) on standard ports. [Private Services](https://render.com/docs/private-services) are available internally over TCP and on multiple ports. However, the Electric sync service requires an inbound TCP ("logical publisher") connection from the Postgres database.

## Allow for Postgres logical replication

Ideally, Render Postgres would support logical replication. This would allow the logical publisher connection to be made over internal TCP from a hosted Render Postgres database.

However, until then, Render could only be used to deploy the sync service. Which would require an incoming TCP connection from an externally hosted Postgres database.

## Allow connecting to non-HTTP services from outside Render

If Render would [support external TCP connections](https://feedback.render.com/features/p/allow-connecting-to-non-http-services-from-outside-render), then you could:

1. deploy the Electric sync service as a [Private Service](https://render.com/docs/private-services)
2. deploy two reverse proxy instances as public [Web Services](https://render.com/docs/web-services)
3. connect the two, so the reverse proxy instances proxy incoming connections to the right internal port, using the right protocol

Specifically, you would need:

- HTTPS to port 5133 (for the Satellite replication protocol, going over WebSockets)
- TCP to port 5133 (for the logical replication publisher -- i.e.: the inbound replication stream into Postgres from Electric)

:::caution
The instructions below are predicated on a feature request pending implementation by Render.com. This will not work until connecting to non-HTTP services from outside Render is supported!
:::

Here's a sample [Render Blueprint](https://render.com/docs/blueprint-spec) `render.yaml`:

```yaml
services:
- type: private
  name: electric
  runtime: image
  image:
    url: electricsql/electric:latest
  envVars:
    - key: AUTH_JWT_ALG
      value: HS512
    - key: AUTH_JWT_KEY
      value: "..."
    - key: DATABASE_URL
      value: "postgresql://..."
    - key: LOGICAL_PUBLISHER_HOST
      fromService:
        type: web
        name: tcp-proxy
        property: host
    - key: LOGICAL_PUBLISHER_PORT
      fromService:
        type: web
        name: tcp-proxy
        property: port
- type: web
  name: http-proxy
  runtime: image
  image:
    url: your-http-configured/nginx:latest
- type: web
  name: tcp-proxy
  runtime: image
  image:
    url: your-tcp-configured/nginx:latest
```

Where `your-http-configured/nginx:latest` is a Nginx docker image with configuration, along these lines:

```nginx
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

    upstream satellite {
        server ELECTRIC_INTERNAL_HOST:5133;
    }

    server {
        listen 10000 ssl;

        location / {
            proxy_pass http://satellite;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
        }
    }
}
```

And `your-tcp-configured/nginx:latest` is a Nginx docker image with configuration, along these lines:

```nginx
stream {
    upstream logical_replication_publisher {
        server ELECTRIC_INTERNAL_HOST:5433;
    }

    server {
        listen 10000;

        proxy_pass logical_replication_publisher;
    }
}
```

Where `ELECTRIC_INTERNAL_HOST` is replaced by the internal private service address.

Unfortunately this is not yet possible.
