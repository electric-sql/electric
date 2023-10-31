---
title: Migrations
description: >-
  How to define and evolve the shared database schema.
sidebar_position: 20
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';
import ExampleSchema from '!!raw-loader!./example.prisma';
import ExampleSQL from '!!raw-loader!./example.sql';

ElectricSQL is designed to work with and on top of a Postgres data model.

If you don't have a data model you can create one using your preferred migrations tooling. You then use the same migrations tooling to extend your data model with [DDLX statements](./electrification.md) to expose data to the replication machinery.

For example, assuming you have a table called `projects`, you can enable replication, grant public read access to it and write access to the project owner as follows:

```sql
ALTER TABLE projects
  ENABLE ELECTRIC;

-- The ELECTRIC ASSIGN and ELECTRIC GRANT DDLX statements are currently
-- a work in progress.
ELECTRIC ASSIGN 'projects:owner'
  TO projects.owner_id;

ELECTRIC GRANT ALL
  ON projects
  TO 'projects:owner';

ELECTRIC GRANT SELECT
  ON projects
  TO ANYONE;
```

:::caution Work in progress
See the [Limitations](#limitations) section below and the [Roadmap](../../reference/roadmap.md) page for more context.
:::

## Migrations proxy

Schema migrations are applied to Postgres via a proxy server integrated into the Electric application.

This proxy server serves various purposes:

- It allows the use of the [DDLX syntax](../../api/ddlx.md) for managing your tables and access permissions,
- It captures migrations applied to Electrified tables in order to propagate those DDL changes to the client schemas,
- It validates migrations to electrified tables to ensure that changes to the schema are supported by Electric (e.g. validating the types of any added columns, ensuring that only additive migrations are applied, etc), and
- It provides an endpoint for schema introspection to allow Electric to return its view of the underlying Postgres database to the data access library.

Migrations not passed through the proxy endpoint will not be captured by Electric and will cause problems as Electric's view of the Postgres schema will be out of sync with the actual table schema.

### Configuring and connecting to the migrations proxy

There are two environment variables that configure the proxy in Electric:

- `PG_PROXY_PORT` (default `65432`). This is the TCP port that [**Electric sync service**](../../api/service.md) will listen on. You should connect to it in order to pass through the migration proxy. Since the proxy speaks fluent Postgres, you can connect to it via any Postgres-compatible tool, e.g. `psql -U electric -p 65432 electric`

- `PG_PROXY_PASSWORD` (no default). Access to the proxy is controlled by password (see below for information on the username). You must set this password here and pass it to any application hoping to connect to the proxy.

The proxy, since it can only connect to the database configured for the rest of the Electric application, ignores any database parameter you provide when connecting, i.e. these commands are all equivalent:

```
$ psql -U electric -p ${PG_PROXY_PORT} electric
$ psql -U electric -p ${PG_PROXY_PORT} my_database
$ psql -U electric -p ${PG_PROXY_PORT} postgres
```

Additionally the username is almost irrelevant except in certain cases, [such as when using Prisma](../../integrations/backend/prisma.md). To avoid complications we suggest using `electric` as the username when connecting to the proxy.

With this in mind, you should be able to connect to the proxy directly using `psql` as outlined above and run any DDLX/migration commands you like. These will be validated, captured, and streamed to any connected clients automatically:

```
$ PGPASSWORD=${PG_PROXY_PASSWORD} psql -U electric -p ${PG_PROXY_PORT} electric

electric=# CREATE TABLE public.items (id text, value text);
CREATE TABLE
-- since we're connecting via the proxy, the DDLX syntax will work
electric=# ALTER TABLE public.items ENABLE ELECTRIC;
ELECTRIC ENABLE
-- this alter table statement affects the newly electrified items table
-- and so will be captured and streamed to any connected clients
electric=# ALTER TABLE public.items ADD COLUMN amount integer;
ALTER TABLE
```

### Framework and application integration

Your framework of choice will need to be configured in order to pass migrations (and _only_ migrations, you shouldn't connect your application to the proxy endpoint for any other purpose) through the proxy rather than directly to the underlying Postgres database.

As each framework has different requirements for this, example code for each is provided in the [integrations section](../../integrations/backend/index.md)

:::caution Work in progress
We are working on providing detailed instructions for as many backend frameworks as possible. If your framework of choice hasn't been documented yet please feel free to raise an issue on our [GitHub repo](https://github.com/electric-sql/electric/issues) and we'll be happy to help.
:::

## Creating a data model

If you have your own Postgres-backed application, use the data model from that and continue using whatever method you're currently using to define the database schema.

Alternatively, if you need to create a data model, you can do so using SQL statements like `CREATE TABLE`, or a migrations tool like [Prisma](../../integrations/backend/prisma.md) or [Ecto](../../integrations/backend/phoenix.md).

Expand the box below for sample code:

<details>
  <summary>Copy code to create data model</summary>
  <Tabs groupId="migration-framework">
    <TabItem value="sql" label="SQL">
      <CodeBlock language="sql">
        {ExampleSQL}
      </CodeBlock>
    </TabItem>
    <TabItem value="prisma" label="Prisma">
      <CodeBlock language="js">
        {ExampleSchema}
      </CodeBlock>
    </TabItem>
  </Tabs>
</details>

## Using your migrations framework

Use [your prefered migrations framework](../../integrations/backend/index.md) to execute [DDLX statements](./electrification.md) via the proxy. For example:

<Tabs groupId="migration-framework">
  <TabItem value="ecto" label="Ecto">

With [Phoenix/Ecto](../../integrations/backend/phoenix.md) you can use the [`execute/1`](https://hexdocs.pm/ecto_sql/Ecto.Migration.html#execute/1) function.

First, create a migration:

```shell
mix ecto.gen.migration electrify_items
```

Then e.g.:

```elixir
defmodule MyApp.Repo.Migrations.ElectrifyItems do
  use Ecto.Migration

  def change do
    execute "ALTER TABLE items ENABLE ELECTRIC"
  end
end
```

  </TabItem>
  <TabItem value="laravel" label="Laravel">

With [Laravel](../../integrations/backend/laravel.md) you can use the [`statement` method on the `DB` facade](https://laravel.com/docs/10.x#databases-and-migrations).

First, create a migration:

```shell
php artisan make:migration electrify_items
```

Then use `DB::statement` in the `up` function:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
  public function up(): void {
    DB::statement("ALTER TABLE items ENABLE ELECTRIC");
  }
};
```

  </TabItem>
  <TabItem value="prisma" label="Prisma">

With [Prisma](../../integrations/backend/prisma.md) you [customize a migration to include an unsupported feature](https://www.prisma.io/docs/guides/migrate/developing-with-prisma-migrate/include-unsupported-database-features).

First, use the `--create-only` flag to generate a new migration without applying it:

```shell
npx prisma migrate dev --create-only
```

Open the generated migration.sql file and add the electrify call:

```sql
ALTER TABLE items ENABLE ELECTRIC;
```

Apply the migration:

```shell
npx prisma migrate dev
```

  </TabItem>
  <TabItem value="active-record" label="Rails">

With [Rails](../../integrations/backend/rails.md) you can `execute` SQL in the [`change` method](https://guides.rubyonrails.org/active_record_migrations.html#using-the-change-method) of your migration class.

First, create a migration:

```shell
rails generate migration ElectrifyItems
```

Then e.g.:

```ruby
class ElectrifyItems < ActiveRecord::Migration[7.0]
  def change
    execute "ALTER TABLE items ENABLE ELECTRIC"
  end
end
```

  </TabItem>
  <TabItem value="alembic" label="SQLAlchemy">

With [SQLAlchemy/Alembic](https://alembic.sqlalchemy.org) you can use the [`Operations.execute`](https://alembic.sqlalchemy.org/en/latest/ops.html#alembic.operations.Operations.execute) method.

First, create a migration:

```shell
alembic revision -m "electrify items"
```

Then execute the SQL in the `upgrade` function:

```python
# ... docstring and revision identifiers ...

from alembic import op
import sqlalchemy as sa

def upgrade():
    op.execute('ALTER TABLE items ENABLE ELECTRIC')
```

  </TabItem>
</Tabs>

See <DocPageLink path="integrations/backend" /> and <DocPageLink path="api/ddlx" /> for more information.

## Limitations

There are currently a number of limitations on the data models and migrations that ElectricSQL supports.

### Forward migrations

We only currently support forward migrations. Rollbacks must be implemented as forward migrations.

### Additive migrations

We only currently support additive migrations. This means you can't remove or restrict a field. Instead, you need to create new fields and tables (that are pre-constrained on creation) and switch / mirror data to them.

In practice this means that we only support this subset of DDL actions:

- `CREATE TABLE` and its associated `ALTER TABLE .. ENABLE ELECTRIC` call,
- `ALTER TABLE electrified_table ADD COLUMN`, and
- `CREATE INDEX ON electrified_table`, `DROP INDEX` -- indexes can be created and dropped because they don't affect the data within the electrified tables.

### Data types and constraints

See the pages on [Types](./types.md) and [Constraints](./constraints.md).
