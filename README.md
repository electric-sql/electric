
# Electric

This is a POC of Postgres active-active replication using Vaxine.

## Pre-reqs

Docker and Elixir 1.13.

## Run databases

```sh
docker-compose -f databases.yaml up
```

## Run app

```sh
mix run --no-halt
```

## Generate workload

For now, manually issue some SQL statements, e.g.:

```
psql -h localhost -p 54321 -U electric -d electric
...
electric=# INSERT INTO entries (content) VALUES ('a');
electric=# select * from entries;
electric=# update entries set content = 'b';
```

Then view the app logs, should look a bit like:

```
{:message,
 %Broadway.Message{
   acknowledger: {Electric.Replication, :ack_id, {#PID<0.218.0>, {0, 24336352}}},
   batch_key: :default,
   batch_mode: :bulk,
   batcher: :default,
   data: %Electric.Replication.Changes.Transaction{
     changes: [
       %Electric.Replication.Changes.NewRecord{
         record: %{
           "content" => "a",
           "id" => "9be3b616-17e9-4264-9f33-5bdb36c48443"
         },
         relation: {"public", "entries"}
       }
     ],
     commit_timestamp: ~U[2022-06-01 14:07:56Z]
   },
   metadata: %{},
   status: :ok
 }}
{:ack, {0, 24336352}}
{:message,
 %Broadway.Message{
   acknowledger: {Electric.Replication, :ack_id, {#PID<0.218.0>, {0, 24336568}}},
   batch_key: :default,
   batch_mode: :bulk,
   batcher: :default,
   data: %Electric.Replication.Changes.Transaction{
     changes: [
       %Electric.Replication.Changes.UpdatedRecord{
         old_record: %{
           "content" => "a",
           "id" => "9be3b616-17e9-4264-9f33-5bdb36c48443"
         },
         record: %{
           "content" => "b",
           "id" => "9be3b616-17e9-4264-9f33-5bdb36c48443"
         },
         relation: {"public", "entries"}
       }
     ],
     commit_timestamp: ~U[2022-06-01 14:08:39Z]
   },
   metadata: %{},
   status: :ok
 }}
```

Note the `old_record` as well as the `new_record`.

