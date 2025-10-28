<p align="center">
  <a href="https://electric-sql.com" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-next.svg"
      />
      <source media="(prefers-color-scheme: light)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
      <img alt="ElectricSQL logo"
          src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/electric-sql/electric/actions"><img src="https://github.com/electric-sql/electric/actions/workflows/elixir_tests.yml/badge.svg"></a>
  <a href="https://github.com/electric-sql/electric/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License - Apache 2.0"></a>
  <a href="https://electric-sql.com/blog/2025/03/17/electricsql-1.0-released"><img src="https://img.shields.io/badge/status-1.0-green" alt="Status - Beta"></a>
  <a href="https://discord.electric-sql.com"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://x.com/ElectricSQL" target="_blank"><img src="https://img.shields.io/twitter/follow/ElectricSQL.svg?style=social&label=Follow @ElectricSQL"></a>
</p>

# Electric <!-- omit in toc -->

Real-time sync for Postgres.

**Table of Contents:**

- [Quick links](#quick-links)
- [What is Electric?](#what-is-electric)
- [Getting Started](#getting-started)
- [HTTP API Docs](#http-api-docs)
- [Developing Electric](#developing-electric)
  - [Mac setup](#mac-setup)
- [Contributing](#contributing)
- [Support](#support)

## Quick links

- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Website](https://electric-sql.com)
- [About](https://electric-sql.com/about)
- [Docs](https://electric-sql.com/docs)
- [Demos](https://electric-sql.com/demos) (also see the [`./examples` folder](./examples))

## What is Electric?

Sync is the magic ingredient behind fast, modern software. From apps like Figma and Linear to AI agents running on live local data.

Electric is a Postgres sync engine. It solves the hard problems of sync for you, including partial replication, fan-out, and data delivery. So you can build awesome software, without rolling your own sync.

Specifically, Electric is a read-path sync engine for Postgres. It syncs data out of Postgres into ... anything you like. The core sync protocol is based on a low-level [HTTP API](https://electric-sql.com/docs/api/http). This integrates with CDNs for highly-scalable data delivery.

Partial replication is managed using [Shapes](https://electric-sql.com/docs/guides/shapes). Sync can be consumed directly or via [client libraries](https://electric-sql.com/docs/api/clients/typescript) and [framework integrations](https://electric-sql.com/docs/api/integrations/react).

## Getting Started

See the [Quickstart guide](https://electric-sql.com/docs/quickstart) to get up and running. In short, you need to:

1. have a Postgres database with logical replication enabled; and then to
2. run Electric in front of it, connected via `DATABASE_URL`

For example, using [Docker Compose](https://docs.docker.com/compose/) from the root of this repo:

```sh
docker compose -f .support/docker-compose.yml up
```

You can then use the [HTTP API](https://electric-sql.com/docs/api/http) to sync data from your Postgres. For example, to start syncing the whole `foo` table:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&offset=-1'
```

Or use one of the clients or integrations, such as the [`useShape`](https://electric-sql.com/docs/api/integrations/react) React hook:

```jsx
import { useShape } from '@electric-sql/react'

function Component() {
  const { data } = useShape({
    url: `http://localhost:3000/v1/shape`,
    params: {
      table: `foo`,
      where: `title LIKE 'foo%'`,
    },
  })

  return JSON.stringify(data)
}
```

Again, see the [Quickstart](https://electric-sql.com/docs/quickstart) and the [Docs](https://electric-sql.com) for more details.

## HTTP API Docs

The HTTP API is defined in an [OpenAPI spec](https://swagger.io/specification/) in [website/electric-api.yaml](./website/electric-api.yaml).

## Developing Electric

We use [asdf](https://asdf-vm.com/) to install Elixir, Erlang, and Node.js. Versions are defined in [.tool-versions](.tool-versions).

### Mac setup

```sh
brew install asdf
asdf plugin add nodejs
asdf plugin add pnpm
asdf plugin add elixir
asdf plugin add erlang
asdf install
```

You'll probably need to fiddle with your bash/zsh/etc rc file to load the right tool into your environment.

### Running Tests

Electric has comprehensive test suites for both Elixir and TypeScript components.

#### Elixir Tests

**Sync Service:**

```sh
cd packages/sync-service
mix test
```

For coverage reports:

```sh
mix coveralls.html
```

**Elixir Client:**

```sh
cd packages/elixir-client
mix test
```

#### TypeScript Tests

**Individual Package:**

```sh
cd packages/typescript-client  # or any other TS package
pnpm test
```

**All TypeScript Packages:**

From the root directory:

```sh
pnpm -r test
```

For coverage:

```sh
pnpm coverage
```

#### Prerequisites for Tests

- Postgres database with logical replication enabled (some tests require it)
- All dependencies installed via `asdf install` and `pnpm install`

## Contributing

See the:

- [Guide to Contributing](https://github.com/electric-sql/electric/blob/main/CONTRIBUTING.md)
- [Contributor License Agreement](https://github.com/electric-sql/electric/blob/main/CLA.md)
- [Community Guidelines](https://github.com/electric-sql/electric/blob/main/CODE_OF_CONDUCT.md)

## Support

We have an [open community Discord](https://discord.electric-sql.com). Come and say hello and let us know if you have any questions or need any help getting things running.

It's also super helpful if you leave the project a star here at the [top of the page☝️](#start-of-content)
