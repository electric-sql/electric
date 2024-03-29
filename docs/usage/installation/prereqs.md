---
title: Prerequisites
description: >-
  NodeJS and either Docker or Elixir.
sidebar_position: 20
---

ElectricSQL requires [NodeJS](https://nodejs.org) and either [Docker](https://docs.docker.com/get-started/overview/) or [Elixir](https://elixir-lang.org).

## NodeJS

You need version `16.11` or higher. You can [download NodeJS here](https://nodejs.org/en/download). Verify using e.g.:

```console
$ node --version
v18.11.0
```

## Docker

You can [install Docker here](https://docs.docker.com/engine/install).

## Elixir

Elixir is optional and only required if you want to compile and run the [sync service](./service.md) directly, rather than using an [official docker build](https://hub.docker.com/r/electricsql/electric).

You can [install Elixir here](https://elixir-lang.org/install.html). Check the [pre-reqs in the source code](https://github.com/electric-sql/electric/tree/main/components/electric#pre-reqs) for version compatibility.
