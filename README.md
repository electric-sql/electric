<p align="center">
  <a href="https://next.electric-sql.com" target="_blank">
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
  <a href="https://github.com/electric-sql/electric/actions"><img src="https://github.com/electric-sql/electric/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://github.com/electric-sql/electric/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License - Apache 2.0"></a>
  <a href="https://github.com/electric-sql/electric-n
  ext/milestones"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status - Alpha"></a>
  <a href="https://discord.electric-sql.com"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://x.com/ElectricSQL" target="_blank"><img src="https://img.shields.io/twitter/follow/ElectricSQL.svg?style=social&label=Follow @ElectricSQL"></a>
</p>

# Electric Next

Your Postgres data, in sync, wherever you need it.

## Quick links

- [About](https://next.electric-sql.com/about)
- [Docs](https://next.electric-sql.com)
- [Examples](./examples)

## What is Electric Next?

This is a clean rebuild of the [ElectricSQL](https://electric-sql.com) sync engine. One that's informed by the lessons learned building the [previous system](https://github.com/electric-sql/electric). See
James' blog post for background on the change: https://next.electric-sql.com/about

It provides an [HTTP API](https://next.electric-sql.com/api/http) for syncing [Shapes](https://next.electric-sql.com/guides/shapes) of data from Postgres. This can be used directly or via [client libraries](https://next.electric-sql.com/api/clients/typescript) and [connectors](https://next.electric-sql.com/api/connectors/react).

It's also simple to [write your own client](https://next.electric-sql.com/guides/write-your-own-client) in any language.

## Getting Started

See the [Quickstart guide](https://next.electric-sql.com/guides/quickstart) to get up and running. In short, you need to:

1. have a Postgres database with logical replication enabled; and then to
2. run Electric in front of it, connected via `DATABASE_URL`

For example, using [Docker Compose](https://docs.docker.com/compose/) from the root of this repo:

```sh
docker compose -f .support/docker-compose.yml up
```

You can then use the [HTTP API](https://next.electric-sql/api/http) to sync data from your Postgres. For example, to start syncing the whole `foo` table:

```sh
curl -i 'http://localhost:3000/v1/shape/foo?offset=-1'
```

Or use one of the clients or connectors, such as the [`useShape`](https://next.electric-sql/api/connectors/react) React hook:

```jsx
import { useShape } from '@electric-sql/react'

function Component() {
  const { data } = useShape({
    url: `http://localhost:3000/v1/shape/foo`,
    where: `title LIKE 'foo%'`,
  })

  return JSON.stringify(data)
}
```

Again, see the [Quickstart](https://next.electric-sql.com/guides/quickstart) and the [Docs](https://next.electric-sql.com) for more details.

## HTTP API Docs

The HTTP API is defined in an [OpenAPI spec](https://swagger.io/specification/) in [docs/electric-api.yaml](./docs/electric-api.yaml).

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
