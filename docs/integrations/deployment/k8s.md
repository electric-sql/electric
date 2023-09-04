---
title: Kubernetes
description: >-
  Open-source system for automating containerized applications.
sidebar_position: 50
---

To run the [Electric sync service](../../api/service.md) in [Kubernetes](https://kubernetes.io) deploy the [Docker image](./docker.md) within a [Pod](https://kubernetes.io/docs/concepts/workloads/controllers/pod), usually via a [Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment).

The container image needs ports `5133` and `5433` exposed and the environment variables described in <DocPageLink path="api/service" /> configured.

For example:

```yaml
# electric-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: electric-deployment
  labels:
    app: electric
spec:
  replicas: 1
  selector:
    matchLabels:
      app: electric
  template:
    metadata:
      labels:
        app: electric
    spec:
      containers:
      - name: electric
        image: electricsql/electric:latest
        env:
        - name: DATABASE_URL
          value: "postgresql://..."
        - name: LOGICAL_PUBLISHER_HOST
          value: "..."
        - name: AUTH_JWT_ALG
          value: "HS512"
        - name: AUTH_JWT_KEY
          value: "..."
        ports:
        - name: satellite-http
          containerPort: 5133
        - name: logical-publisher-tcp
          containerPort: 5433
```

You can organise a deployment of Electric with Postgres and any other services using a [Helm chart](https://helm.sh/docs/topics/charts/).
