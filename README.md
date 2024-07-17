# ElectricSQL (@next)

Postgres Sync for modern apps.

## Getting Started

1. Install the TypeScript client and React integrations
`npm install electric-next electric-next/react`

2. Run Docker Compose similar to the following to setup Postgres and Electric

`docker-compose.yaml`

```docker
version: "3.8"
name: "todomvc"

configs:
  postgres_config:
    file: "./postgres/postgres.conf"

volumes:
  pg_data:

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: pg_password
    command:
      - -c
      - config_file=/etc/postgresql.conf
    configs:
      - source: postgres_config
        target: /etc/postgresql.conf
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ports:
      - 5632:5432
    volumes:
      - pg_data:/var/lib/postgresql/data

# TODO add Electric image
```

Add a `postgresql.conf` file.

```
listen_addresses = '*'
wal_level = 'logical'
```

Start Docker: `docker compose -f ./docker-compose.yaml up`

3. Create a table and insert some data:

```sql
CREATE TABLE foo (
    id INT PRIMARY KEY AUTO_INCREMENT, -- Unique identifier, auto-incrementing
    name VARCHAR(255),                  -- Text field for names (adjust size as needed)
    value FLOAT                         -- Numeric value (can be decimal)
);

INSERT INTO foo (name, value) VALUES 
    ('Alice', 3.14),
    ('Bob', 2.71),
    ('Charlie', -1.618),
    ('David', 1.414),
    ('Eve', 0);
```

3. Try a curl command to Electric's HTTP API:

`curl http://localhost:3000/shape/foo`

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
