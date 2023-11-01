---
title: Django
description: >-
  High-level pragmatic Python web framework for rapid development.
sidebar_position: 10
---

## Migrations

### Proxying

To run your migrations [through the proxy](../../usage/data-modelling/migrations.md#migrations-proxy) add a `proxy` database to your settings:

```python
DATABASES = {
    'default': {
        # ...
    },
    'proxy': {
        'ENGINE': 'django.db.backends.postgresql_psycopg2',
        # Database name is ignored.
        'NAME': 'mydb',
        # User is normally `postgres`.
        'USER': 'postgres',
        # Password is the password you configure using `PG_PROXY_PASSWORD`
        # when running the Electric sync service.
        'PASSWORD': 'my-proxy-password',
        # Host is the hostname where you're running Electric.
        'HOST': 'localhost',
        # Port is the `PG_PROXY_PORT` you set when running Electric,
        # which defaults to 65432.
        'PORT': '65432'
    }
}
```

Then when you run `python manage.py ...` commands, specify `--database=proxy`, e.g.:

```shell
./manage.py migrate --database=proxy
```

### Applying DDLX statements

Use the [`RunSQL`](https://docs.djangoproject.com/en/4.2/ref/migration-operations/#runsql) operation.

First, create a migration:

```shell
python manage.py makemigrations \
    --empty \
    --name electrify_items \
    app_label
```

Then add a `RunSQL` operation to the generated migration file, e.g.:

```python
from django.db import migrations

class Migration(migrations.Migration):
    dependencies = []

    operations = [
        migrations.RunSQL(
            """
            ALTER TABLE items
              ENABLE ELECTRIC;
            """
        )
    ]
  end
end
```

## Event sourcing

One way of consuming a change feed from Postgres in Python is to use the [psycopg2.extras.LogicalReplicationConnection](https://www.psycopg.org/docs/extras.html#psycopg2.extras.LogicalReplicationConnection).

See <DocPageLink path="integrations/event-sourcing" /> for more information.
