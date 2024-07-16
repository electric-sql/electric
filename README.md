# ElectricSQL (@next)

Postgres Sync for modern apps.

## Getting Started

1. Install the TypeScript client and React integrations
`npm install @electric-sql/client @electric-sql/react`

2. Run Docker Compose similar to the following to setup Postgres and Electric
```docker
Etc.
```

`command to run Docker w/ correct environment variables etc.

3. Try a curl command
`curl http://localhost:3000/shape/{table}`

4. Add to React app
```tsx
Show adding provider
```

```tsx
Show using `useHook` to fetch and use data
```

## How to setup your development environment to work on Electric

We're using [asdf](https://asdf-vm.com/) to install Elixir, Erlang, and Node.js.

### Mac setup

1. `brew install asdf`
2. `asdf plugin-add nodejs elixir erlang`
3. `asdf install`

You'll probably need to fiddle with your bash/zsh/etc rc file to load the right tool into your environment.

## HTTP API Documentation

The HTTP API documentation is defined through an OpenAPI 3.1.0 specification found in `docs/electric-api.yaml`. Documentation for the API can be generated with `npm run docs:generate`.

## Contributing

See the [Community Guidelines](https://github.com/electric-sql/electric/blob/main/CODE_OF_CONDUCT.md) including the [Guide to Contributing](https://github.com/electric-sql/electric/blob/main/CONTRIBUTING.md) and [Contributor License Agreement](https://github.com/electric-sql/electric/blob/main/CLA.md).

## Support

We have an [open community Discord](https://discord.electric-sql.com). Come and say hello and let us know if you have any questions or need any help getting things running.

It's also super helpful if you leave the project a star here at the [top of the page☝️](#start-of-content)
