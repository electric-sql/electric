---
title: Job queues
description: >-
  Trigger jobs to run background processes and workflows.
sidebar_position: 30
---

Postgres-backed job queues provide a simple and reliable way to handle data changes.

There are many job queue systems that use Postgres to store and dispatch tasks, e.g.:

- [Oban](https://hexdocs.pm/oban/Oban.html) (Elixir)
- [Procrastinate](https://procrastinate.readthedocs.io) (Python)
- [pg-boss](https://github.com/timgit/pg-boss) (Node)

Taking [Oban](https://hexdocs.pm/oban/Oban.html) as an example, they have a specific syntax for inserting jobs into Postgres server-side using Elixir, e.g.:

```elixir
attrs = %{
  event: 'user:created', 
  data: %{
    user_id: '...'
  }
}

attrs
|> Oban.Job.new(worker: MyApp.Worker)
|> Oban.insert()
```

However, what this does under the hood is simply insert a row into an `oban_jobs` table. It's perfectly possible (and valid / supported) to insert records into that table directly. You can do this either in the frontend, or in a trigger.

### Using the frontend

In your DDLX rules, electrify the `oban_jobs` table:

```sql
ALTER TABLE oban_jobs
  ENABLE ELECTRIC;
```

Then use the [Electric Client](../../usage/data-access/client.md) directly in your local-first app to insert into the jobs table, e.g.:

```tsx
await db.oban_jobs.create({
  data: {
    args: {
      event: 'user:created',
      data: {
        user_id: user.id
      }
    },
    worker: 'MyApp.Worker'
  }
})
```

The job will run when the insert replicates to Postgres.

### Using triggers

Another approach is to setup a [Postgres trigger](https://www.postgresql.org/docs/current/sql-createtrigger.html) to write into the job queue table when other data is inserted, updated or deleted.

For example, to setup a trigger to insert a job when a user is inserted, with the same job args (aka event data) as the example above:

```sql
CREATE FUNCTION trigger_function()
  RETURNS TRIGGER
  LANGUAGE PLPGSQL
  AS
$$
BEGIN
  INSERT INTO oban_jobs (
    args,
    worker
  )
  VALUES (
    to_jsonb(
      format(
        '{'
          '"event": "user:created", '
          '"data": {'
            '"user_id": "%s"'
          '}'
        '}',
        NEW.VALUE
      )
    ),
    'MyApp.Worker'
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_name
  AFTER INSERT
    ON users
  FOR EACH ROW
  EXECUTE PROCEDURE
    trigger_function();
```
