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
  <a href="https://github.com/electric-sql/electric-n
  ext/milestones"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status - Alpha"></a>
  <a href="https://discord.electric-sql.com"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://x.com/ElectricSQL" target="_blank"><img src="https://img.shields.io/twitter/follow/ElectricSQL.svg?style=social&label=Follow @ElectricSQL"></a>
</p>

# Electric

Your Postgres data, in sync, wherever you need it.

## Quick links

- [Quickstart](https://electric-sql.com/docs/quickstart)
- [About](https://electric-sql.com/about)
- [Docs](https://electric-sql.com/docs)
- [Examples](./examples)

## What is Electric?

Electric provides an [HTTP API](https://electric-sql.com/docs/api/http) for syncing [Shapes](https://electric-sql.com/docs/guides/shapes) of data from Postgres. This can be used directly or via [client libraries](https://electric-sql.com/docs/api/clients/typescript) and [integrations](https://electric-sql.com/docs/api/integrations/react).

### This looks a bit different than the last time I visited?

We started a clean rebuild of the sync engine in July 2024. One that's informed by the lessons learned building the [previous system](https://github.com/electric-sql/electric-old). See
[James' blog post for background on the change](https://electric-sql.com/blog/2024/07/17/electric-next).

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
    table: `foo`,
    where: `title LIKE 'foo%'`,
  })

  return JSON.stringify(data)
}
```

Again, see the [Quickstart](https://electric-sql.com/docs/quickstart) and the [Docs](https://electric-sql.com) for more details.

## HTTP API Docs

The HTTP API is defined in an [OpenAPI spec](https://swagger.io/specification/) in [website/electric-api.yaml](./website/electric-api.yaml).

## Developing Electric

We're using [asdf](https://asdf-vm.com/) to install Elixir, Erlang, and Node.js. Versions are defined in [.tool-versions](.tool-versions).

### Mac setup

```sh
brew install asdf
asdf plugin-add nodejs elixir erlang
asdf install
```

You'll probably need to fiddle with your bash/zsh/etc rc file to load the right tool into your environment.

## Contributing

See the:

- [Guide to Contributing](https://github.com/electric-sql/electric/blob/main/CONTRIBUTING.md)
- [Contributor License Agreement](https://github.com/electric-sql/electric/blob/main/CLA.md)
- [Community Guidelines](https://github.com/electric-sql/electric/blob/main/CODE_OF_CONDUCT.md)

## Support

We have an [open community Discord](https://discord.electric-sql.com). Come and say hello and let us know if you have any questions or need any help getting things running.

It's also super helpful if you leave the project a star here at the [top of the page☝️](#start-of-content)
