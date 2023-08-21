---
title: SQLAlchemy
description: >-
  Python SQL toolkit and object relational mapper.
sidebar_position: 70
---

## Migrations

Use the [`Operations.execute`](https://alembic.sqlalchemy.org/en/latest/ops.html#alembic.operations.Operations.execute) method.

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

## Event sourcing

One way of consuming a change feed from Postgres in Python is to use the [psycopg2.extras.LogicalReplicationConnection](https://www.psycopg.org/docs/extras.html#psycopg2.extras.LogicalReplicationConnection).

See <DocPageLink path="integrations/event-sourcing" /> for more information.
