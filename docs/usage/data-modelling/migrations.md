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

:::caution Limitations
See the [limitations page](../../reference/limitations.md) for context.
:::

ElectricSQL is designed to work with and on top of a Postgres data model.

If you don't have a data model you can create one using your preferred migrations tooling. You then use the same migrations tooling to extend your data model with [DDLX statements](./electrification.md) to expose data to the replication machinery.

For example, assuming you have a table called `projects`, you can enable replication, grant public read access to it and write access to the project owner as follows:

```sql
ALTER TABLE projects
  ENABLE ELECTRIC;

ELECTRIC ASSIGN 'projects:owner'
  TO projects.owner_id;

ELECTRIC GRANT ALL
  ON projects
  TO 'projects:owner';

ELECTRIC GRANT SELECT
  ON projects
  TO ANYONE;
```

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

Use [your prefered migrations framework](../../integrations/backend/index.md) to execute [DDLX statements](./electrification.md). For example:

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

### Data types

ElectricSQL maps between Postgres data types on the server and SQLite data types in the local app. This is not a perfect match. In many cases, SQLite does not have native support for a Postgres data type.

### Primary keys

We do not support sequential autoincrementing integer IDs. You must use binary UUIDs.

### Constraints

We support referential integrity. We do not currently support unique or check constraints. We plan to do so [using Rich-CRDTs](/blog/2022/05/03/introducing-rich-crdts).
