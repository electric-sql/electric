The starter template has set you up with a simple data model defined in `./db/migrations`. To evolve the schema you can add additional files and run `yarn db:migrate` again, e.g.:

```shell
echo '
  CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  ALTER TABLE accounts ENABLE ELECTRIC;
' > db/migrations/02-create_foo_table.sql

yarn db:migrate
```
